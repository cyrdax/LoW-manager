import type Database from 'better-sqlite3';
import { createFitStore, type LibraryVisibility, type SavedFitSummary } from './store.ts';

type SqliteDatabase = Database.Database;

export interface DoctrineFitMember extends SavedFitSummary {
  sortOrder: number;
}

export interface DoctrineSummary {
  id: number;
  ownerUserId: string | null;
  visibility: LibraryVisibility;
  sourcePublicDoctrineId: number | null;
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
  list(queryOrFilters?: string | DoctrineListFilters): DoctrineSummary[];
  get(id: number): DoctrineDetail | null;
  create(input: { name: string; description?: string; ownerUserId?: string | null; visibility?: LibraryVisibility; sourcePublicDoctrineId?: number | null }): DoctrineDetail;
  update(id: number, input: { name?: string; description?: string }): DoctrineDetail | null;
  publish(id: number): DoctrineDetail | null;
  copyToPrivate(id: number, ownerUserId: string): DoctrineDetail | null;
  delete(id: number): boolean;
  addFit(doctrineId: number, fitId: number): DoctrineDetail | null;
  removeFit(doctrineId: number, fitId: number): DoctrineDetail | null;
}

export interface DoctrineListFilters {
  q?: string;
  visibility?: LibraryVisibility;
  ownerUserId?: string;
}

interface DoctrineRow {
  id: number;
  owner_user_id: string | null;
  visibility: LibraryVisibility;
  source_public_doctrine_id: number | null;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export function migrateDoctrinesDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS doctrines (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT,
      visibility  TEXT NOT NULL DEFAULT 'private',
      source_public_doctrine_id INTEGER,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (source_public_doctrine_id) REFERENCES doctrines(id) ON DELETE SET NULL
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
  const columns = database.prepare('PRAGMA table_info(doctrines)').all() as Array<{ name: string }>;
  if (!columns.some(col => col.name === 'owner_user_id')) database.prepare('ALTER TABLE doctrines ADD COLUMN owner_user_id TEXT').run();
  if (!columns.some(col => col.name === 'visibility')) database.prepare("ALTER TABLE doctrines ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'").run();
  if (!columns.some(col => col.name === 'source_public_doctrine_id')) database.prepare('ALTER TABLE doctrines ADD COLUMN source_public_doctrine_id INTEGER REFERENCES doctrines(id) ON DELETE SET NULL').run();
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_doctrines_owner_visibility ON doctrines(owner_user_id, visibility, updated_at);
    CREATE INDEX IF NOT EXISTS idx_doctrines_public ON doctrines(updated_at) WHERE visibility = 'public';
  `);
}

export function createDoctrineStore(database: SqliteDatabase, options: { now?: () => number } = {}): DoctrineStore {
  const now = options.now ?? (() => Date.now());
  const fitStore = createFitStore(database);

  const getRow = database.prepare('SELECT * FROM doctrines WHERE id = ?');
  const insertDoctrine = database.prepare(`
    INSERT INTO doctrines (owner_user_id, visibility, source_public_doctrine_id, name, description, created_at, updated_at)
    VALUES (@ownerUserId, @visibility, @sourcePublicDoctrineId, @name, @description, @createdAt, @updatedAt)
  `);
  const updateDoctrine = database.prepare(`
    UPDATE doctrines
    SET name = @name,
        description = @description,
        updated_at = @updatedAt
    WHERE id = @id
  `);
  const touchDoctrine = database.prepare('UPDATE doctrines SET updated_at = ? WHERE id = ?');
  const nextOrder = database.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM doctrine_fits WHERE doctrine_id = ?');
  const insertFit = database.prepare(`
    INSERT OR IGNORE INTO doctrine_fits (doctrine_id, fit_id, sort_order)
    VALUES (@doctrineId, @fitId, @sortOrder)
  `);

  return {
    list(queryOrFilters = ''): DoctrineSummary[] {
      const filters = typeof queryOrFilters === 'string' ? { q: queryOrFilters } : queryOrFilters;
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
      const rows = database.prepare(
        `SELECT * FROM doctrines${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC`,
      ).all(...params) as DoctrineRow[];
      const q = (filters.q ?? '').trim().toLowerCase();
      return rows
        .map(row => readDetail(database, fitStore, row.id))
        .filter((detail): detail is DoctrineDetail => detail != null)
        .filter(detail => !q || matchesDoctrine(detail, q))
        .map(detailToSummary);
    },

    get(id: number): DoctrineDetail | null {
      return readDetail(database, fitStore, id);
    },

    create(input): DoctrineDetail {
      const name = cleanName(input.name);
      if (!name) throw new Error('Doctrine name is required.');
      const timestamp = now();
      const info = insertDoctrine.run({
        ownerUserId: input.ownerUserId ?? null,
        visibility: input.visibility ?? 'private',
        sourcePublicDoctrineId: input.sourcePublicDoctrineId ?? null,
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

    publish(id: number): DoctrineDetail | null {
      if (!getRow.get(id)) return null;
      const links = database.prepare('SELECT fit_id FROM doctrine_fits WHERE doctrine_id = ? ORDER BY sort_order, fit_id').all(id) as Array<{ fit_id: number }>;
      const privateFits = links
        .map(link => fitStore.get(link.fit_id))
        .filter(fit => fit && fit.visibility !== 'public');
      if (privateFits.length > 0) throw new Error('Cannot publish doctrine with private member fits.');
      database.prepare("UPDATE doctrines SET visibility = 'public', updated_at = ? WHERE id = ?").run(now(), id);
      return readDetail(database, fitStore, id);
    },

    copyToPrivate(id: number, ownerUserId: string): DoctrineDetail | null {
      const source = readDetail(database, fitStore, id);
      if (!source) return null;
      const copiedDoctrine = this.create({
        name: source.name,
        description: source.description,
        ownerUserId,
        visibility: 'private',
        sourcePublicDoctrineId: source.id,
      });
      for (const fit of source.fits) {
        const copiedFit = fitStore.copyToPrivate(fit.id, ownerUserId);
        if (copiedFit) this.addFit(copiedDoctrine.id, copiedFit.id);
      }
      return readDetail(database, fitStore, copiedDoctrine.id);
    },

    delete(id: number): boolean {
      return database.prepare('DELETE FROM doctrines WHERE id = ?').run(id).changes > 0;
    },

    addFit(doctrineId: number, fitId: number): DoctrineDetail | null {
      const doctrine = getRow.get(doctrineId) as DoctrineRow | undefined;
      if (!doctrine) return null;
      const fit = fitStore.get(fitId);
      if (!fit) throw new Error('Saved fit not found.');
      if (doctrine.visibility === 'public' && fit.visibility !== 'public') {
        throw new Error('Public doctrine member fits must be public.');
      }
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
        ownerUserId: fit.ownerUserId,
        visibility: fit.visibility,
        sourcePublicFitId: fit.sourcePublicFitId,
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
    ownerUserId: row.owner_user_id,
    visibility: row.visibility ?? 'private',
    sourcePublicDoctrineId: row.source_public_doctrine_id,
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
