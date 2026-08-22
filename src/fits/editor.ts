import type { AssignedFitItem, FitDraft, FitSectionRole, FitsV2EditorDocument, FitsV2EditorItem, FitsV2ModuleState } from './types.ts';

const EDITOR_ROLES = new Set<FitSectionRole>([
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
]);

const MODULE_STATES = new Set<FitsV2ModuleState>(['offline', 'online', 'active', 'overheated']);
const EFT_ROLE_ORDER: FitSectionRole[] = ['low', 'mid', 'high', 'rig', 'service', 'subsystem', 'droneBay', 'fighterBay', 'extras', 'unmatched'];

export function parseFitsV2EditorDocument(value: unknown): FitsV2EditorDocument | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (!isRecord(value.hull)) return null;
  const hull = {
    typeId: positiveInteger(value.hull.typeId),
    name: cleanString(value.hull.name),
    groupId: positiveInteger(value.hull.groupId),
    groupName: cleanString(value.hull.groupName),
  };
  if (!hull.typeId || !hull.name || !hull.groupId || !hull.groupName) return null;

  if (!Array.isArray(value.items)) return null;
  const items: FitsV2EditorItem[] = [];
  for (const rawItem of value.items) {
    const item = parseEditorItem(rawItem);
    if (!item) return null;
    items.push(item);
  }

  const skillProfile = isRecord(value.skillProfile)
    ? {
        kind: value.skillProfile.kind === 'pilot' ? 'pilot' as const : 'all-v' as const,
        characterId: value.skillProfile.kind === 'pilot' ? positiveInteger(value.skillProfile.characterId) : null,
        name: cleanString(value.skillProfile.name) || (value.skillProfile.kind === 'pilot' ? 'Pilot' : 'All V'),
      }
    : { kind: 'all-v' as const, characterId: null, name: 'All V' };
  if (skillProfile.kind === 'pilot' && !skillProfile.characterId) return null;

  return {
    version: 1,
    hull,
    fitName: cleanString(value.fitName) || hull.name,
    notes: cleanString(value.notes),
    skillProfile,
    items,
  };
}

export function assertFitsV2EditorDocument(value: unknown): FitsV2EditorDocument {
  const document = parseFitsV2EditorDocument(value);
  if (!document) throw new Error('editorJson is not a valid Fits v2 editor document');
  return document;
}

export function serializeFitsV2EditorDocument(value: FitsV2EditorDocument | null | undefined): string | null {
  if (value == null) return null;
  return JSON.stringify(assertFitsV2EditorDocument(value));
}

export function parseSerializedFitsV2EditorDocument(value: unknown): FitsV2EditorDocument | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return parseFitsV2EditorDocument(value);
  try {
    return parseFitsV2EditorDocument(JSON.parse(value));
  } catch {
    return null;
  }
}

export function editorDocumentFromFitDraft(draft: FitDraft): FitsV2EditorDocument {
  if (!draft.ship) throw new Error('Cannot create Fits v2 editor data without a resolved ship.');
  const chargeByLine = new Map<string, AssignedFitItem>();
  for (const item of draft.items) {
    if (item.source === 'loaded-charge') chargeByLine.set(lineKey(item), item);
  }
  const roleCursor = new Map<FitSectionRole, number>();
  const items = draft.items
    .filter(item => item.source === 'fit-line' && item.typeId != null)
    .map(item => {
      const charge = chargeByLine.get(lineKey(item));
      const slotIndex = slotIndexForEditorItem(item, roleCursor);
      return {
        editorItemId: `${item.role}-${item.lineIndex}-${item.typeId}`,
        typeId: item.typeId!,
        name: item.resolvedName ?? item.inputName,
        role: item.role,
        quantity: item.quantity,
        slotIndex,
        state: 'offline' as const,
        chargeTypeId: charge?.typeId ?? null,
        chargeName: charge?.resolvedName ?? charge?.inputName ?? null,
      };
    });

  return {
    version: 1,
    hull: draft.ship,
    fitName: draft.fitName,
    notes: '',
    skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
    items,
  };
}

export function renderFitsV2EditorDocumentToEft(document: FitsV2EditorDocument): string {
  const lines: string[] = [`[${document.hull.name}, ${document.fitName}]`];
  for (const role of EFT_ROLE_ORDER) {
    const roleItems = document.items.filter(item => item.role === role);
    if (roleItems.length === 0) continue;
    lines.push('');
    for (const item of roleItems) {
      const base = item.chargeName ? `${item.name}, ${item.chargeName}` : item.name;
      lines.push(item.quantity === 1 ? base : `${base} x${item.quantity}`);
    }
  }
  return lines.join('\n');
}

function parseEditorItem(value: unknown): FitsV2EditorItem | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  const state = value.state;
  if (typeof role !== 'string' || !EDITOR_ROLES.has(role as FitSectionRole)) return null;
  if (typeof state !== 'string' || !MODULE_STATES.has(state as FitsV2ModuleState)) return null;
  const typeId = positiveInteger(value.typeId);
  const quantity = positiveInteger(value.quantity);
  const editorItemId = cleanString(value.editorItemId);
  const name = cleanString(value.name);
  if (!typeId || !quantity || !editorItemId || !name) return null;
  return {
    editorItemId,
    typeId,
    name,
    role: role as FitSectionRole,
    quantity,
    slotIndex: value.slotIndex == null ? null : nonNegativeInteger(value.slotIndex),
    state: state as FitsV2ModuleState,
    chargeTypeId: value.chargeTypeId == null ? null : positiveInteger(value.chargeTypeId),
    chargeName: value.chargeName == null ? null : cleanString(value.chargeName),
  };
}

function lineKey(item: Pick<AssignedFitItem, 'sectionIndex' | 'lineIndex'>): string {
  return `${item.sectionIndex}:${item.lineIndex}`;
}

function slotIndexForEditorItem(
  item: AssignedFitItem,
  roleCursor: Map<FitSectionRole, number>,
): number | null {
  if (item.role === 'droneBay' || item.role === 'fighterBay' || item.role === 'extras' || item.role === 'unmatched') return null;
  const next = roleCursor.get(item.role) ?? 0;
  roleCursor.set(item.role, next + 1);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function nonNegativeInteger(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
