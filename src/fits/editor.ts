import type { FitSectionRole, FitsV2EditorDocument, FitsV2EditorItem, FitsV2ModuleState } from './types.ts';

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
