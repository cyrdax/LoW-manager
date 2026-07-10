export type FitSectionRole =
  | 'low'
  | 'mid'
  | 'high'
  | 'rig'
  | 'service'
  | 'subsystem'
  | 'droneBay'
  | 'fighterBay'
  | 'extras'
  | 'unmatched';

export type FitWarningCode =
  | 'parse-error'
  | 'ship-unmatched'
  | 'unmatched-item'
  | 'over-slot'
  | 'metadata-missing'
  | 'unassignable';

export type EsiFitFlag =
  | 'Cargo'
  | 'DroneBay'
  | 'FighterBay'
  | `HiSlot${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | `MedSlot${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | `LoSlot${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | `RigSlot${0 | 1 | 2}`
  | `ServiceSlot${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | `SubSystemSlot${0 | 1 | 2 | 3}`;

export interface ParsedFitHeader {
  rawLine: string;
  lineIndex: number;
  shipName: string;
  fitName: string;
}

export interface ParsedFitLine {
  sectionIndex: number;
  lineIndex: number;
  rawLine: string;
  itemName: string;
  quantity: number;
  loadedChargeName: string | null;
}

export interface ParsedFitSection {
  sectionIndex: number;
  startLineIndex: number;
  lines: ParsedFitLine[];
}

export interface ParsedFitText {
  rawEft: string;
  header: ParsedFitHeader;
  sections: ParsedFitSection[];
  lines: ParsedFitLine[];
}

export interface RenderEftInput {
  shipName: string;
  fitName: string;
  lines: ParsedFitLine[];
}

export interface FitWarning {
  code: FitWarningCode;
  message: string;
  inputName?: string;
  count?: number;
}

export interface FitShip {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
}

export interface FitItem {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
}

export interface FitShipLayout {
  shipTypeId: number;
  shipName: string;
  highSlots: number;
  midSlots: number;
  lowSlots: number;
  rigSlots: number;
  serviceSlots: number;
  subsystemSlots: number;
  warnings: FitWarning[];
}

export interface FitShipSearchHit extends FitShip {}

export interface AssignedFitItem {
  id: string;
  source: 'fit-line' | 'loaded-charge';
  sectionIndex: number;
  lineIndex: number;
  rawLine: string;
  inputName: string;
  resolvedName: string | null;
  typeId: number | null;
  quantity: number;
  role: FitSectionRole;
  slotFlag: EsiFitFlag | null;
  warning: FitWarning | null;
}

export interface AssignedFitSection {
  role: FitSectionRole;
  label: string;
  slotCount: number;
  emptySlots: number;
  items: AssignedFitItem[];
}

export interface FitDraft {
  rawEft: string;
  fitName: string;
  headerShipName: string;
  ship: FitShip | null;
  layout: FitShipLayout | null;
  sections: Record<FitSectionRole, AssignedFitSection>;
  items: AssignedFitItem[];
  warnings: FitWarning[];
  normalizedEft: string;
}
