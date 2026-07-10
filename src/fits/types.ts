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
