import type Database from 'better-sqlite3';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';
import { withTransaction, type TransactionSource } from '../db/transaction.ts';
import {
  createFitStore,
  createPostgresFitStore,
  type AsyncFitStore,
  type FitStore,
  type LibraryVisibility,
  type SavedFitSummary,
} from './store.ts';

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

export interface AsyncDoctrineStore {
  list(queryOrFilters?: string | DoctrineListFilters): Promise<DoctrineSummary[]>;
  get(id: number): Promise<DoctrineDetail | null>;
  create(input: { name: string; description?: string; ownerUserId?: string | null; visibility?: LibraryVisibility; sourcePublicDoctrineId?: number | null }): Promise<DoctrineDetail>;
  update(id: number, input: { name?: string; description?: string }): Promise<DoctrineDetail | null>;
  publish(id: number): Promise<DoctrineDetail | null>;
  copyToPrivate(id: number, ownerUserId: string): Promise<DoctrineDetail | null>;
  delete(id: number): Promise<boolean>;
  addFit(doctrineId: number, fitId: number): Promise<DoctrineDetail | null>;
  removeFit(doctrineId: number, fitId: number): Promise<DoctrineDetail | null>;
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

interface PostgresDoctrineRow {
  id: string | number;
  owner_user_id: string | null;
  visibility: LibraryVisibility;
  source_public_doctrine_id: string | number | null;
  name: string;
  description: string;
  created_at: Date | string | number;
  updated_at: Date | string | number;
}

interface PostgresDoctrineOptions {
  now?: () => Date;
  fitStore?: AsyncFitStore;
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

export function createPostgresDoctrineStore(
  source: TransactionSource = getPostgresPool(),
  options: PostgresDoctrineOptions = {},
): AsyncDoctrineStore {
  const now = options.now ?? (() => new Date());
  const fitStore = options.fitStore ?? createPostgresFitStore(source);

  async function createDoctrine(client: QueryClient, input: {
    name: string;
    description?: string;
    ownerUserId?: string | null;
    visibility?: LibraryVisibility;
    sourcePublicDoctrineId?: number | null;
  }): Promise<DoctrineDetail> {
    const name = cleanName(input.name);
    if (!name) throw new Error('Doctrine name is required.');
    const timestamp = now();
    const result = await client.query<{ id: string | number }>(
      `
        INSERT INTO doctrines (
          owner_user_id, visibility, source_public_doctrine_id, name, description, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        input.ownerUserId ?? null,
        input.visibility ?? 'private',
        input.sourcePublicDoctrineId ?? null,
        name,
        input.description?.trim() ?? '',
        timestamp,
        timestamp,
      ],
    );
    return (await readPostgresDetail(client, fitStore, Number(result.rows[0].id)))!;
  }

  async function addFitToDoctrine(client: QueryClient, doctrineId: number, fitId: number): Promise<DoctrineDetail | null> {
    const doctrine = await readPostgresDoctrineRow(client, doctrineId);
    if (!doctrine) return null;
    const fit = await fitStore.get(fitId);
    if (!fit) throw new Error('Saved fit not found.');
    if (doctrine.visibility === 'public' && fit.visibility !== 'public') {
      throw new Error('Public doctrine member fits must be public.');
    }
    const orderResult = await client.query<{ next_order: string | number }>(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM doctrine_fits WHERE doctrine_id = $1',
      [doctrineId],
    );
    const insert = await client.query(
      `
        INSERT INTO doctrine_fits (doctrine_id, fit_id, sort_order)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [doctrineId, fitId, Number(orderResult.rows[0].next_order)],
    );
    if ((insert.rowCount ?? 0) > 0) {
      await client.query('UPDATE doctrines SET updated_at = $1 WHERE id = $2', [now(), doctrineId]);
    }
    return readPostgresDetail(client, fitStore, doctrineId);
  }

  return {
    async list(queryOrFilters = '') {
      const filters = typeof queryOrFilters === 'string' ? { q: queryOrFilters } : queryOrFilters;
      const params: unknown[] = [];
      const where: string[] = [];
      if (filters.visibility) {
        params.push(filters.visibility);
        where.push(`visibility = $${params.length}`);
      }
      if (filters.ownerUserId) {
        params.push(filters.ownerUserId);
        where.push(`owner_user_id = $${params.length}`);
      }
      const rows = await source.query<PostgresDoctrineRow>(
        `SELECT * FROM doctrines${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC`,
        params,
      );
      const q = (filters.q ?? '').trim().toLowerCase();
      const details = await Promise.all(rows.rows.map(row => readPostgresDetail(source, fitStore, Number(row.id))));
      return details
        .filter((detail): detail is DoctrineDetail => detail != null)
        .filter(detail => !q || matchesDoctrine(detail, q))
        .map(detailToSummary);
    },

    async get(id) {
      return readPostgresDetail(source, fitStore, id);
    },

    async create(input) {
      return withTransaction(source, client => createDoctrine(client, input));
    },

    async update(id, input) {
      const existing = await readPostgresDoctrineRow(source, id);
      if (!existing) return null;
      const name = input.name == null ? existing.name : cleanName(input.name);
      if (!name) throw new Error('Doctrine name is required.');
      const result = await source.query<{ id: string | number }>(
        `
          UPDATE doctrines
          SET name = $1,
              description = $2,
              updated_at = $3
          WHERE id = $4
          RETURNING id
        `,
        [
          name,
          input.description == null ? existing.description : input.description.trim(),
          now(),
          id,
        ],
      );
      return result.rows.length > 0 ? readPostgresDetail(source, fitStore, id) : null;
    },

    async publish(id) {
      const doctrine = await readPostgresDoctrineRow(source, id);
      if (!doctrine) return null;
      const links = await source.query<{ fit_id: string | number }>(
        'SELECT fit_id FROM doctrine_fits WHERE doctrine_id = $1 ORDER BY sort_order, fit_id',
        [id],
      );
      const privateFits = (await Promise.all(links.rows.map(link => fitStore.get(Number(link.fit_id)))))
        .filter(fit => fit && fit.visibility !== 'public');
      if (privateFits.length > 0) throw new Error('Cannot publish doctrine with private member fits.');
      await source.query("UPDATE doctrines SET visibility = 'public', updated_at = $1 WHERE id = $2", [now(), id]);
      return readPostgresDetail(source, fitStore, id);
    },

    async copyToPrivate(id, ownerUserId) {
      return withTransaction(source, async client => {
        const sourceDoctrine = await readPostgresDetail(client, fitStore, id);
        if (!sourceDoctrine) return null;
        const copiedDoctrine = await createDoctrine(client, {
          name: sourceDoctrine.name,
          description: sourceDoctrine.description,
          ownerUserId,
          visibility: 'private',
          sourcePublicDoctrineId: sourceDoctrine.id,
        });
        for (const fit of sourceDoctrine.fits) {
          const copiedFit = await fitStore.copyToPrivate(fit.id, ownerUserId);
          if (copiedFit) await addFitToDoctrine(client, copiedDoctrine.id, copiedFit.id);
        }
        return readPostgresDetail(client, fitStore, copiedDoctrine.id);
      });
    },

    async delete(id) {
      const result = await source.query('DELETE FROM doctrines WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async addFit(doctrineId, fitId) {
      return withTransaction(source, client => addFitToDoctrine(client, doctrineId, fitId));
    },

    async removeFit(doctrineId, fitId) {
      const doctrine = await readPostgresDoctrineRow(source, doctrineId);
      if (!doctrine) return null;
      const result = await source.query(
        'DELETE FROM doctrine_fits WHERE doctrine_id = $1 AND fit_id = $2',
        [doctrineId, fitId],
      );
      if ((result.rowCount ?? 0) > 0) {
        await source.query('UPDATE doctrines SET updated_at = $1 WHERE id = $2', [now(), doctrineId]);
      }
      return readPostgresDetail(source, fitStore, doctrineId);
    },
  };
}

function readDetail(database: SqliteDatabase, fitStore: FitStore, id: number): DoctrineDetail | null {
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

async function readPostgresDoctrineRow(client: QueryClient, id: number): Promise<DoctrineRow | null> {
  const result = await client.query<PostgresDoctrineRow>('SELECT * FROM doctrines WHERE id = $1', [id]);
  return result.rows[0] ? mapPostgresDoctrineRow(result.rows[0]) : null;
}

async function readPostgresDetail(
  client: QueryClient,
  fitStore: AsyncFitStore,
  id: number,
): Promise<DoctrineDetail | null> {
  const row = await readPostgresDoctrineRow(client, id);
  if (!row) return null;
  const links = await client.query<{ fit_id: string | number; sort_order: string | number }>(
    'SELECT fit_id, sort_order FROM doctrine_fits WHERE doctrine_id = $1 ORDER BY sort_order, fit_id',
    [id],
  );
  const fits = (await Promise.all(links.rows.map(async link => {
    const fit = await fitStore.get(Number(link.fit_id));
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
      sortOrder: Number(link.sort_order),
    } satisfies DoctrineFitMember;
  }))).filter((fit): fit is DoctrineFitMember => fit != null);

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

function mapPostgresDoctrineRow(row: PostgresDoctrineRow): DoctrineRow {
  return {
    id: Number(row.id),
    owner_user_id: row.owner_user_id,
    visibility: row.visibility ?? 'private',
    source_public_doctrine_id: row.source_public_doctrine_id == null ? null : Number(row.source_public_doctrine_id),
    name: row.name,
    description: row.description,
    created_at: toEpochMs(row.created_at),
    updated_at: toEpochMs(row.updated_at),
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

function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}
