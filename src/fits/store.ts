import type Database from 'better-sqlite3';
import { buildFitDraft } from './assignment.ts';
import { getShipLayout, resolveShipByTypeId } from './metadata.ts';
import type {
  AssignedFitItem,
  AssignedFitSection,
  EsiFitFlag,
  FitDraft,
  FitSectionRole,
  FitShip,
  FitShipLayout,
  FitWarning,
} from './types.ts';

type SqliteDatabase = Database.Database;
export type LibraryVisibility = 'private' | 'public';

export interface SaveFitInput {
  rawEft: string;
  shipTypeId?: number;
  fitName?: string;
  notes?: string;
  ownerUserId?: string | null;
  visibility?: LibraryVisibility;
  sourcePublicFitId?: number | null;
}

export interface UpdateFitInput {
  rawEft?: string;
  shipTypeId?: number;
  fitName?: string;
  notes?: string;
}

export interface SavedFitWarningCounts {
  unmatched: number;
  overSlot: number;
  unassignable: number;
}

export interface SavedFitSummary {
  id: number;
  ownerUserId: string | null;
  visibility: LibraryVisibility;
  sourcePublicFitId: number | null;
  shipTypeId: number;
  shipName: string;
  fitName: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  warningCounts: SavedFitWarningCounts;
}

export interface SavedFitDetail extends FitDraft {
  id: number;
  ownerUserId: string | null;
  visibility: LibraryVisibility;
  sourcePublicFitId: number | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface FitStore {
  list(filters?: { visibility?: LibraryVisibility; ownerUserId?: string }): SavedFitSummary[];
  get(id: number): SavedFitDetail | null;
  create(input: SaveFitInput): SavedFitDetail;
  update(id: number, input: UpdateFitInput): SavedFitDetail | null;
  publish(id: number): SavedFitDetail | null;
  copyToPrivate(id: number, ownerUserId: string): SavedFitDetail | null;
  delete(id: number): boolean;
}

interface FitStoreOptions {
  now?: () => number;
}

interface SavedFitRow {
  id: number;
  owner_user_id: string | null;
  visibility: LibraryVisibility;
  source_public_fit_id: number | null;
  ship_type_id: number;
  ship_name: string;
  fit_name: string;
  notes: string;
  raw_eft: string;
  created_at: number;
  updated_at: number;
}

interface SavedFitItemRow {
  id: number;
  fit_id: number;
  source: AssignedFitItem['source'];
  section_index: number;
  line_index: number;
  raw_line: string;
  input_name: string;
  resolved_name: string | null;
  type_id: number | null;
  quantity: number;
  role: FitSectionRole;
  slot_flag: EsiFitFlag | null;
  warning: string | null;
}

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

export function migrateFitsDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS saved_fits (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT,
      visibility   TEXT NOT NULL DEFAULT 'private',
      source_public_fit_id INTEGER,
      ship_type_id INTEGER NOT NULL,
      ship_name    TEXT NOT NULL,
      fit_name     TEXT NOT NULL,
      notes        TEXT NOT NULL DEFAULT '',
      raw_eft      TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      FOREIGN KEY (source_public_fit_id) REFERENCES saved_fits(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS saved_fit_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fit_id        INTEGER NOT NULL,
      source        TEXT NOT NULL DEFAULT 'fit-line',
      section_index INTEGER NOT NULL,
      line_index    INTEGER NOT NULL,
      raw_line      TEXT NOT NULL,
      input_name    TEXT NOT NULL,
      resolved_name TEXT,
      type_id       INTEGER,
      quantity      INTEGER NOT NULL,
      role          TEXT NOT NULL,
      slot_flag     TEXT,
      warning       TEXT,
      FOREIGN KEY (fit_id) REFERENCES saved_fits(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_saved_fits_updated ON saved_fits(updated_at);
    CREATE INDEX IF NOT EXISTS idx_saved_fits_ship ON saved_fits(ship_name);
    CREATE INDEX IF NOT EXISTS idx_saved_fit_items_fit ON saved_fit_items(fit_id);
  `);
  const columns = database.prepare('PRAGMA table_info(saved_fits)').all() as Array<{ name: string }>;
  if (!columns.some(col => col.name === 'owner_user_id')) database.prepare('ALTER TABLE saved_fits ADD COLUMN owner_user_id TEXT').run();
  if (!columns.some(col => col.name === 'visibility')) database.prepare("ALTER TABLE saved_fits ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'").run();
  if (!columns.some(col => col.name === 'source_public_fit_id')) database.prepare('ALTER TABLE saved_fits ADD COLUMN source_public_fit_id INTEGER REFERENCES saved_fits(id) ON DELETE SET NULL').run();
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_saved_fits_owner_visibility ON saved_fits(owner_user_id, visibility, updated_at);
    CREATE INDEX IF NOT EXISTS idx_saved_fits_public ON saved_fits(updated_at) WHERE visibility = 'public';
  `);
}

export function createFitStore(database: SqliteDatabase, options: FitStoreOptions = {}): FitStore {
  const now = options.now ?? (() => Date.now());

  const selectFit = database.prepare('SELECT * FROM saved_fits WHERE id = ?');
  const selectItems = database.prepare('SELECT * FROM saved_fit_items WHERE fit_id = ? ORDER BY id');
  const insertFit = database.prepare(`
    INSERT INTO saved_fits (
      owner_user_id, visibility, source_public_fit_id,
      ship_type_id, ship_name, fit_name, notes, raw_eft, created_at, updated_at
    )
    VALUES (
      @ownerUserId, @visibility, @sourcePublicFitId,
      @shipTypeId, @shipName, @fitName, @notes, @rawEft, @createdAt, @updatedAt
    )
  `);
  const updateFit = database.prepare(`
    UPDATE saved_fits
    SET ship_type_id = @shipTypeId,
        ship_name = @shipName,
        fit_name = @fitName,
        notes = @notes,
        raw_eft = @rawEft,
        updated_at = @updatedAt
    WHERE id = @id
  `);
  const deleteItems = database.prepare('DELETE FROM saved_fit_items WHERE fit_id = ?');
  const insertItem = database.prepare(`
    INSERT INTO saved_fit_items (
      fit_id, source, section_index, line_index, raw_line, input_name, resolved_name,
      type_id, quantity, role, slot_flag, warning
    )
    VALUES (
      @fitId, @source, @sectionIndex, @lineIndex, @rawLine, @inputName, @resolvedName,
      @typeId, @quantity, @role, @slotFlag, @warning
    )
  `);

  const persistItems = database.transaction((fitId: number, items: AssignedFitItem[]) => {
    deleteItems.run(fitId);
    for (const item of items) {
      insertItem.run({
        fitId,
        source: item.source,
        sectionIndex: item.sectionIndex,
        lineIndex: item.lineIndex,
        rawLine: item.rawLine,
        inputName: item.inputName,
        resolvedName: item.resolvedName,
        typeId: item.typeId,
        quantity: item.quantity,
        role: item.role,
        slotFlag: item.slotFlag,
        warning: item.warning ? JSON.stringify(item.warning) : null,
      });
    }
  });

  const createTx = database.transaction((input: SaveFitInput) => {
    const draft = buildFitDraft(input.rawEft, input.shipTypeId);
    if (!draft.ship) throw new Error('Cannot save a fit without a resolved ship.');
    const timestamp = now();
    const fitName = cleanText(input.fitName) || draft.fitName;
    const info = insertFit.run({
      ownerUserId: input.ownerUserId ?? null,
      visibility: input.visibility ?? 'private',
      sourcePublicFitId: input.sourcePublicFitId ?? null,
      shipTypeId: draft.ship.typeId,
      shipName: draft.ship.name,
      fitName,
      notes: input.notes ?? '',
      rawEft: input.rawEft,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const id = Number(info.lastInsertRowid);
    persistItems(id, draft.items);
    return id;
  });

  const updateTx = database.transaction((id: number, input: UpdateFitInput) => {
    const existing = selectFit.get(id) as SavedFitRow | undefined;
    if (!existing) return null;

    const rawEft = input.rawEft ?? existing.raw_eft;
    const shipTypeId = input.shipTypeId ?? existing.ship_type_id;
    const draft = buildFitDraft(rawEft, shipTypeId);
    if (!draft.ship) throw new Error('Cannot save a fit without a resolved ship.');
    const timestamp = now();
    const fitName = cleanText(input.fitName) || existing.fit_name || draft.fitName;
    updateFit.run({
      id,
      shipTypeId: draft.ship.typeId,
      shipName: draft.ship.name,
      fitName,
      notes: input.notes ?? existing.notes,
      rawEft,
      updatedAt: timestamp,
    });
    persistItems(id, draft.items);
    return id;
  });

  return {
    list(filters = {}): SavedFitSummary[] {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filters.visibility) {
        where.push('visibility = ?');
        params.push(filters.visibility);
      }
      if (filters.ownerUserId) {
        where.push('owner_user_id = ?');
        params.push(filters.ownerUserId);
      }
      const sql = `SELECT id FROM saved_fits${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC`;
      const rows = database.prepare(sql).all(...params) as Array<{ id: number }>;
      return rows
        .map(row => detailToSummary(readDetail(database, row.id)))
        .filter((row): row is SavedFitSummary => row != null);
    },

    get(id: number): SavedFitDetail | null {
      return readDetail(database, id);
    },

    create(input: SaveFitInput): SavedFitDetail {
      return readDetail(database, createTx(input))!;
    },

    update(id: number, input: UpdateFitInput): SavedFitDetail | null {
      const updatedId = updateTx(id, input);
      return updatedId == null ? null : readDetail(database, updatedId);
    },

    publish(id: number): SavedFitDetail | null {
      const result = database.prepare("UPDATE saved_fits SET visibility = 'public', updated_at = ? WHERE id = ?").run(now(), id);
      return result.changes > 0 ? readDetail(database, id) : null;
    },

    copyToPrivate(id: number, ownerUserId: string): SavedFitDetail | null {
      const source = readDetail(database, id);
      if (!source) return null;
      return readDetail(database, createTx({
        rawEft: source.rawEft,
        shipTypeId: source.ship?.typeId,
        fitName: source.fitName,
        notes: source.notes,
        ownerUserId,
        visibility: 'private',
        sourcePublicFitId: source.id,
      }));
    },

    delete(id: number): boolean {
      const result = database.prepare('DELETE FROM saved_fits WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

function readDetail(database: SqliteDatabase, id: number): SavedFitDetail | null {
  const fit = database.prepare('SELECT * FROM saved_fits WHERE id = ?').get(id) as SavedFitRow | undefined;
  if (!fit) return null;
  const rows = database.prepare('SELECT * FROM saved_fit_items WHERE fit_id = ? ORDER BY id').all(id) as SavedFitItemRow[];
  const ship = resolveShipByTypeId(fit.ship_type_id) ?? {
    typeId: fit.ship_type_id,
    name: fit.ship_name,
    groupId: 0,
    groupName: 'Unknown',
  };
  const layout = getShipLayout(fit.ship_type_id);
  const items = rows.map(rowToItem);
  const warnings = items.flatMap(item => item.warning ? [item.warning] : []);

  return {
    id: fit.id,
    ownerUserId: fit.owner_user_id,
    visibility: fit.visibility ?? 'private',
    sourcePublicFitId: fit.source_public_fit_id,
    rawEft: fit.raw_eft,
    fitName: fit.fit_name,
    headerShipName: fit.ship_name,
    ship,
    layout,
    sections: buildSections(items, layout),
    items,
    warnings,
    normalizedEft: buildFitDraft(fit.raw_eft, fit.ship_type_id).normalizedEft.replace(
      /^\[[^\]]+\]/,
      `[${ship.name}, ${fit.fit_name}]`,
    ),
    notes: fit.notes,
    createdAt: fit.created_at,
    updatedAt: fit.updated_at,
  };
}

function rowToItem(row: SavedFitItemRow): AssignedFitItem {
  return {
    id: String(row.id),
    source: row.source,
    sectionIndex: row.section_index,
    lineIndex: row.line_index,
    rawLine: row.raw_line,
    inputName: row.input_name,
    resolvedName: row.resolved_name,
    typeId: row.type_id,
    quantity: row.quantity,
    role: row.role,
    slotFlag: row.slot_flag,
    warning: parseWarning(row.warning),
  };
}

function detailToSummary(detail: SavedFitDetail | null): SavedFitSummary | null {
  if (!detail?.ship) return null;
  return {
    id: detail.id,
    ownerUserId: detail.ownerUserId,
    visibility: detail.visibility,
    sourcePublicFitId: detail.sourcePublicFitId,
    shipTypeId: detail.ship.typeId,
    shipName: detail.ship.name,
    fitName: detail.fitName,
    notes: detail.notes,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    itemCount: detail.items.length,
    warningCounts: countWarnings(detail.warnings),
  };
}

function countWarnings(warnings: FitWarning[]): SavedFitWarningCounts {
  return {
    unmatched: warnings.filter(w => w.code === 'unmatched-item').length,
    overSlot: warnings.filter(w => w.code === 'over-slot').length,
    unassignable: warnings.filter(w => w.code === 'unassignable').length,
  };
}

function buildSections(
  items: AssignedFitItem[],
  layout: FitShipLayout,
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

function slotCountFor(role: FitSectionRole, layout: FitShipLayout): number {
  if (role === 'low') return layout.lowSlots;
  if (role === 'mid') return layout.midSlots;
  if (role === 'high') return layout.highSlots;
  if (role === 'rig') return layout.rigSlots;
  if (role === 'service') return layout.serviceSlots;
  if (role === 'subsystem') return layout.subsystemSlots;
  return 0;
}

function isSlotRole(role: FitSectionRole): boolean {
  return role === 'low'
    || role === 'mid'
    || role === 'high'
    || role === 'rig'
    || role === 'service'
    || role === 'subsystem';
}

function parseWarning(raw: string | null): FitWarning | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FitWarning;
  } catch {
    return { code: 'metadata-missing', message: raw };
  }
}

function cleanText(value: string | undefined): string {
  return value?.trim() ?? '';
}
