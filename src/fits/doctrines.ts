import type Database from 'better-sqlite3';
import { createFitStore, type SavedFitSummary } from './store.ts';

type SqliteDatabase = Database.Database;

export interface DoctrineFitMember extends SavedFitSummary {
  sortOrder: number;
}

export interface DoctrineSummary {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  fitCount: number;
  shipNames: string[];
}

export interface DoctrineDetail extends DoctrineSummary {
  fits: DoctrineFitMember[];
}

export interface DoctrineStore {
  list(query?: string): DoctrineSummary[];
  get(id: number): DoctrineDetail | null;
  create(input: { name: string; description?: string }): DoctrineDetail;
  update(id: number, input: { name?: string; description?: string }): DoctrineDetail | null;
  delete(id: number): boolean;
  addFit(doctrineId: number, fitId: number): DoctrineDetail | null;
  removeFit(doctrineId: number, fitId: number): DoctrineDetail | null;
}

interface DoctrineRow {
  id: number;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export function migrateDoctrinesDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS doctrines (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctrine_fits (
      doctrine_id INTEGER NOT NULL,
      fit_id      INTEGER NOT NULL,
      sort_order  INTEGER NOT NULL,
      PRIMARY KEY (doctrine_id, fit_id),
      FOREIGN KEY (doctrine_id) REFERENCES doctrines(id) ON DELETE CASCADE,
      FOREIGN KEY (fit_id) REFERENCES saved_fits(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_doctrines_updated ON doctrines(updated_at);
    CREATE INDEX IF NOT EXISTS idx_doctrine_fits_doctrine ON doctrine_fits(doctrine_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_doctrine_fits_fit ON doctrine_fits(fit_id);
  `);
}

export function createDoctrineStore(database: SqliteDatabase, options: { now?: () => number } = {}): DoctrineStore {
  const now = options.now ?? (() => Date.now());
  const fitStore = createFitStore(database);

  const getRow = database.prepare('SELECT * FROM doctrines WHERE id = ?');
  const insertDoctrine = database.prepare(`
    INSERT INTO doctrines (name, description, created_at, updated_at)
    VALUES (@name, @description, @createdAt, @updatedAt)
  `);
  const updateDoctrine = database.prepare(`
    UPDATE doctrines
    SET name = @name,
        description = @description,
        updated_at = @updatedAt
    WHERE id = @id
  `);
  const touchDoctrine = database.prepare('UPDATE doctrines SET updated_at = ? WHERE id = ?');
  const fitExists = database.prepare('SELECT id FROM saved_fits WHERE id = ?');
  const nextOrder = database.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM doctrine_fits WHERE doctrine_id = ?');
  const insertFit = database.prepare(`
    INSERT OR IGNORE INTO doctrine_fits (doctrine_id, fit_id, sort_order)
    VALUES (@doctrineId, @fitId, @sortOrder)
  `);

  return {
    list(query = ''): DoctrineSummary[] {
      const rows = database.prepare('SELECT * FROM doctrines ORDER BY updated_at DESC, id DESC').all() as DoctrineRow[];
      const q = query.trim().toLowerCase();
      return rows
        .map(row => readDetail(database, fitStore, row.id))
        .filter((detail): detail is DoctrineDetail => detail != null)
        .filter(detail => !q || matchesDoctrine(detail, q))
        .map(detailToSummary);
    },

    get(id: number): DoctrineDetail | null {
      return readDetail(database, fitStore, id);
    },

    create(input: { name: string; description?: string }): DoctrineDetail {
      const name = cleanName(input.name);
      if (!name) throw new Error('Doctrine name is required.');
      const timestamp = now();
      const info = insertDoctrine.run({
        name,
        description: input.description?.trim() ?? '',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return readDetail(database, fitStore, Number(info.lastInsertRowid))!;
    },

    update(id: number, input: { name?: string; description?: string }): DoctrineDetail | null {
      const existing = getRow.get(id) as DoctrineRow | undefined;
      if (!existing) return null;
      const name = input.name == null ? existing.name : cleanName(input.name);
      if (!name) throw new Error('Doctrine name is required.');
      updateDoctrine.run({
        id,
        name,
        description: input.description == null ? existing.description : input.description.trim(),
        updatedAt: now(),
      });
      return readDetail(database, fitStore, id);
    },

    delete(id: number): boolean {
      return database.prepare('DELETE FROM doctrines WHERE id = ?').run(id).changes > 0;
    },

    addFit(doctrineId: number, fitId: number): DoctrineDetail | null {
      if (!getRow.get(doctrineId)) return null;
      if (!fitExists.get(fitId)) throw new Error('Saved fit not found.');
      const sortOrder = (nextOrder.get(doctrineId) as { nextOrder: number }).nextOrder;
      const result = insertFit.run({ doctrineId, fitId, sortOrder });
      if (result.changes > 0) touchDoctrine.run(now(), doctrineId);
      return readDetail(database, fitStore, doctrineId);
    },

    removeFit(doctrineId: number, fitId: number): DoctrineDetail | null {
      if (!getRow.get(doctrineId)) return null;
      const result = database.prepare('DELETE FROM doctrine_fits WHERE doctrine_id = ? AND fit_id = ?').run(doctrineId, fitId);
      if (result.changes > 0) touchDoctrine.run(now(), doctrineId);
      return readDetail(database, fitStore, doctrineId);
    },
  };
}

function readDetail(database: SqliteDatabase, fitStore: ReturnType<typeof createFitStore>, id: number): DoctrineDetail | null {
  const row = database.prepare('SELECT * FROM doctrines WHERE id = ?').get(id) as DoctrineRow | undefined;
  if (!row) return null;
  const links = database.prepare('SELECT fit_id, sort_order FROM doctrine_fits WHERE doctrine_id = ? ORDER BY sort_order, fit_id').all(id) as Array<{ fit_id: number; sort_order: number }>;
  const fits = links
    .map(link => {
      const fit = fitStore.get(link.fit_id);
      if (!fit?.ship) return null;
      return {
        id: fit.id,
        shipTypeId: fit.ship.typeId,
        shipName: fit.ship.name,
        fitName: fit.fitName,
        notes: fit.notes,
        createdAt: fit.createdAt,
        updatedAt: fit.updatedAt,
        itemCount: fit.items.length,
        warningCounts: {
          unmatched: fit.warnings.filter(w => w.code === 'unmatched-item').length,
          overSlot: fit.warnings.filter(w => w.code === 'over-slot').length,
          unassignable: fit.warnings.filter(w => w.code === 'unassignable').length,
        },
        sortOrder: link.sort_order,
      } satisfies DoctrineFitMember;
    })
    .filter((fit): fit is DoctrineFitMember => fit != null);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fitCount: fits.length,
    shipNames: [...new Set(fits.map(fit => fit.shipName))],
    fits,
  };
}

function detailToSummary(detail: DoctrineDetail): DoctrineSummary {
  const { fits: _fits, ...summary } = detail;
  return summary;
}

function matchesDoctrine(detail: DoctrineDetail, query: string): boolean {
  const haystack = [
    detail.name,
    detail.description,
    ...detail.fits.map(fit => fit.shipName),
    ...detail.fits.map(fit => fit.fitName),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function cleanName(value: string | undefined): string {
  return value?.trim() ?? '';
}
