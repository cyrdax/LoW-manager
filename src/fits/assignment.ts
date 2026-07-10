import { getShipLayout, classifyFitItem, resolveItemByName, resolveShipByName, resolveShipByTypeId } from './metadata.ts';
import { parseEftFit, renderEftFit } from './parser.ts';
import type {
  AssignedFitItem,
  AssignedFitSection,
  EsiFitFlag,
  FitDraft,
  FitItem,
  FitSectionRole,
  FitShip,
  FitShipLayout,
  FitWarning,
  ParsedFitLine,
  ParsedFitText,
} from './types.ts';

const DISPLAY_ROLES: FitSectionRole[] = [
  'low',
  'mid',
  'high',
  'rig',
  'service',
  'subsystem',
  'droneBay',
  'fighterBay',
  'extras',
  'unmatched',
];

const SECTION_ROLES: FitSectionRole[] = ['low', 'mid', 'high', 'rig'];

const ROLE_LABELS: Record<FitSectionRole, string> = {
  low: 'Low Slots',
  mid: 'Mid Slots',
  high: 'High Slots',
  rig: 'Rigs',
  service: 'Service Slots',
  subsystem: 'Subsystems',
  droneBay: 'Drone Bay',
  fighterBay: 'Fighter Bay',
  extras: 'Cargo / Extras',
  unmatched: 'Unmatched',
};

const SLOT_COUNTS: Record<FitSectionRole, keyof FitShipLayout | null> = {
  low: 'lowSlots',
  mid: 'midSlots',
  high: 'highSlots',
  rig: 'rigSlots',
  service: 'serviceSlots',
  subsystem: 'subsystemSlots',
  droneBay: null,
  fighterBay: null,
  extras: null,
  unmatched: null,
};

export function buildFitDraft(rawEft: string, shipOverrideTypeId?: number): FitDraft {
  const parsed = parseEftFit(rawEft);
  const ship = shipOverrideTypeId != null
    ? resolveShipByTypeId(shipOverrideTypeId)
    : resolveShipByName(parsed.header.shipName);
  const layout = ship ? getShipLayout(ship.typeId) : null;
  return assignFitRows(parsed, ship, layout);
}

export function assignFitRows(
  parsed: ParsedFitText,
  ship: FitShip | null,
  layout: FitShipLayout | null,
): FitDraft {
  const warnings: FitWarning[] = [];
  if (!ship) {
    warnings.push({
      code: 'ship-unmatched',
      message: `Ship hull "${parsed.header.shipName}" could not be resolved.`,
      inputName: parsed.header.shipName,
    });
  }
  if (layout) warnings.push(...layout.warnings);

  const slotCursor: Partial<Record<FitSectionRole, number>> = {};
  const items: AssignedFitItem[] = [];

  for (const line of parsed.lines) {
    const item = resolveItemByName(line.itemName);
    const row = buildItemRow({
      source: 'fit-line',
      line,
      inputName: line.itemName,
      quantity: line.quantity,
      item,
      role: chooseRole(line, item),
      layout,
      warnings,
      slotCursor,
    });
    items.push(row);

    if (line.loadedChargeName) {
      const charge = resolveItemByName(line.loadedChargeName);
      items.push(buildItemRow({
        source: 'loaded-charge',
        line,
        inputName: line.loadedChargeName,
        quantity: 1,
        item: charge,
        role: charge ? 'extras' : 'unmatched',
        layout,
        warnings,
        slotCursor,
      }));
    }
  }

  return {
    rawEft: parsed.rawEft,
    fitName: parsed.header.fitName,
    headerShipName: parsed.header.shipName,
    ship,
    layout,
    sections: buildSections(items, layout),
    items,
    warnings,
    normalizedEft: renderEftFit({
      shipName: ship?.name ?? parsed.header.shipName,
      fitName: parsed.header.fitName,
      lines: parsed.lines,
    }),
  };
}

function buildItemRow(input: {
  source: AssignedFitItem['source'];
  line: ParsedFitLine;
  inputName: string;
  quantity: number;
  item: FitItem | null;
  role: FitSectionRole;
  layout: FitShipLayout | null;
  warnings: FitWarning[];
  slotCursor: Partial<Record<FitSectionRole, number>>;
}): AssignedFitItem {
  const warning = warningForRow(input);
  if (warning) input.warnings.push(warning);
  const slotFlag = warning?.code === 'over-slot' || warning?.code === 'unmatched-item'
    ? null
    : assignFlag(input.role, input.layout, input.slotCursor);

  const unassignable = input.item && isSlotRole(input.role) && !slotFlag && warning?.code !== 'over-slot'
    ? {
        code: 'unassignable' as const,
        message: `${input.inputName} cannot be assigned to an ESI fitting flag.`,
        inputName: input.inputName,
      }
    : null;
  if (unassignable) input.warnings.push(unassignable);

  return {
    id: `${input.line.sectionIndex}:${input.line.lineIndex}:${input.source}:${input.inputName}`,
    source: input.source,
    sectionIndex: input.line.sectionIndex,
    lineIndex: input.line.lineIndex,
    rawLine: input.line.rawLine,
    inputName: input.inputName,
    resolvedName: input.item?.name ?? null,
    typeId: input.item?.typeId ?? null,
    quantity: input.quantity,
    role: input.role,
    slotFlag,
    warning: warning ?? unassignable,
  };
}

function chooseRole(line: ParsedFitLine, item: FitItem | null): FitSectionRole {
  const classified = classifyFitItem(item);
  if (classified) return classified;
  return SECTION_ROLES[line.sectionIndex] ?? 'extras';
}

function warningForRow(input: {
  inputName: string;
  item: FitItem | null;
  role: FitSectionRole;
  layout: FitShipLayout | null;
  slotCursor: Partial<Record<FitSectionRole, number>>;
}): FitWarning | null {
  if (!input.item) {
    return {
      code: 'unmatched-item',
      message: `${input.inputName} could not be resolved.`,
      inputName: input.inputName,
    };
  }

  if (!isSlotRole(input.role)) return null;
  const slotCount = slotCountFor(input.role, input.layout);
  const nextIndex = input.slotCursor[input.role] ?? 0;
  if (nextIndex >= slotCount) {
    return {
      code: 'over-slot',
      message: `${input.inputName} exceeds available ${ROLE_LABELS[input.role].toLowerCase()}.`,
      inputName: input.inputName,
      count: nextIndex + 1,
    };
  }
  return null;
}

function assignFlag(
  role: FitSectionRole,
  layout: FitShipLayout | null,
  slotCursor: Partial<Record<FitSectionRole, number>>,
): EsiFitFlag | null {
  if (role === 'extras') return 'Cargo';
  if (role === 'droneBay') return 'DroneBay';
  if (role === 'fighterBay') return 'FighterBay';
  if (!isSlotRole(role)) return null;

  const slotCount = slotCountFor(role, layout);
  const index = slotCursor[role] ?? 0;
  slotCursor[role] = index + 1;
  if (index >= slotCount) return null;

  if (role === 'low' && index < 8) return `LoSlot${index}` as EsiFitFlag;
  if (role === 'mid' && index < 8) return `MedSlot${index}` as EsiFitFlag;
  if (role === 'high' && index < 8) return `HiSlot${index}` as EsiFitFlag;
  if (role === 'rig' && index < 3) return `RigSlot${index}` as EsiFitFlag;
  if (role === 'service' && index < 8) return `ServiceSlot${index}` as EsiFitFlag;
  if (role === 'subsystem' && index < 4) return `SubSystemSlot${index}` as EsiFitFlag;
  return null;
}

function buildSections(
  items: AssignedFitItem[],
  layout: FitShipLayout | null,
): Record<FitSectionRole, AssignedFitSection> {
  const sections = {} as Record<FitSectionRole, AssignedFitSection>;
  for (const role of DISPLAY_ROLES) {
    const roleItems = items.filter(item => item.role === role);
    const slotCount = slotCountFor(role, layout);
    sections[role] = {
      role,
      label: ROLE_LABELS[role],
      slotCount,
      emptySlots: isSlotRole(role) ? Math.max(0, slotCount - Math.min(slotCount, roleItems.length)) : 0,
      items: roleItems,
    };
  }
  return sections;
}

function slotCountFor(role: FitSectionRole, layout: FitShipLayout | null): number {
  const key = SLOT_COUNTS[role];
  if (!key || !layout) return 0;
  return layout[key] as number;
}

function isSlotRole(role: FitSectionRole): boolean {
  return role === 'low'
    || role === 'mid'
    || role === 'high'
    || role === 'rig'
    || role === 'service'
    || role === 'subsystem';
}
