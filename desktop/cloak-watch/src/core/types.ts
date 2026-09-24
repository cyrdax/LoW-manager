export interface ParsedLogEntry {
  occurredAt: string;
  category: string;
  message: string;
}

export interface DecloakEvent {
  characterName: string;
  occurredAt: string;
  message: string;
  sourceFile: string;
  byteOffset: number;
}

export interface DecloakContext {
  characterName: string | null;
  sourceFile: string;
  byteOffset: number;
}
