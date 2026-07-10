# Doctrine Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build doctrine management inside the existing Fits tab, where doctrines are searchable collections of saved fits with a doctrine-level description.

**Architecture:** Add a DB-backed doctrine store in `src/fits/doctrines.ts`, register doctrine routes under `/api/doctrines`, then add frontend API helpers and a dedicated `DoctrinesView` that shares the Fits two-pane layout. Doctrines reference `saved_fits` by ID, so saved fit edits automatically appear in doctrine detail.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Node test runner, React, Vite.

## Global Constraints

- V1 doctrines are simple collections of existing saved fits.
- A doctrine has a name, a description, timestamps, and an ordered set of saved-fit members.
- Members do not have per-doctrine roles, quantities, pricing, or export behavior in this version.
- Search matches doctrine name, doctrine description, member ship name, and member fit name.
- Adding the same fit twice is treated as success/no-op.
- Removing a non-member fit from an existing doctrine is treated as success/no-op.
- Deleting a doctrine does not delete saved fits.
- If a saved fit is deleted, it is removed from all doctrines through cascade delete.
- Drag-and-drop member reordering is out of scope; `sort_order` exists so ordering can be added without a schema change.

---

## File Structure

- Create `src/fits/doctrines.ts`: doctrine migration, doctrine store, exported doctrine types.
- Create `src/fits/doctrines.test.ts`: migration, CRUD, membership, cascade, and search tests.
- Create `src/routes/doctrines.ts`: Fastify doctrine endpoints.
- Create `src/routes/doctrines.test.ts`: route behavior and validation tests.
- Modify `src/db.ts`: run doctrine migration after saved fit migration.
- Modify `src/server.ts`: register doctrine routes.
- Modify `web/src/api.ts`: doctrine API types and helpers.
- Create `web/src/components/FitModeSwitch.tsx`: compact `Fits | Doctrines` segmented switch.
- Create `web/src/components/DoctrinesView.tsx`: doctrine library, detail pane, add/remove controls.
- Modify `web/src/components/FitsView.tsx`: wrap existing saved-fit UI with the mode switch and render `DoctrinesView` when selected.
- Modify `web/src/styles.css`: shared Fits/Doctrine mode and doctrine-specific styling.
- Create `src/fits/doctrine-view.test.ts`: structural frontend guard for the new doctrine UI/API.

---

### Task 1: Doctrine Store And Migration

**Files:**
- Create: `src/fits/doctrines.ts`
- Create: `src/fits/doctrines.test.ts`
- Modify: `src/db.ts`

**Interfaces:**
- Consumes: `SavedFitSummary` and `createFitStore(database)` from `src/fits/store.ts`.
- Produces:
  - `migrateDoctrinesDb(database: Database.Database): void`
  - `createDoctrineStore(database: Database.Database, options?: { now?: () => number }): DoctrineStore`
  - `DoctrineStore.create(input: { name: string; description?: string }): DoctrineDetail`
  - `DoctrineStore.update(id: number, input: { name?: string; description?: string }): DoctrineDetail | null`
  - `DoctrineStore.delete(id: number): boolean`
  - `DoctrineStore.list(query?: string): DoctrineSummary[]`
  - `DoctrineStore.get(id: number): DoctrineDetail | null`
  - `DoctrineStore.addFit(doctrineId: number, fitId: number): DoctrineDetail | null`
  - `DoctrineStore.removeFit(doctrineId: number, fitId: number): DoctrineDetail | null`

- [ ] **Step 1: Write failing doctrine store tests**

Create `src/fits/doctrines.test.ts` with these tests:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateFitsDb, createFitStore } from './store.ts';
import { createDoctrineStore, migrateDoctrinesDb } from './doctrines.ts';

const naglfar = `[Naglfar, Dread DPS]
Republic Fleet Gyrostabilizer
Siege Module II`;

const archon = `[Archon, Cheap Drones]
Drone Damage Amplifier II
Capital I-a Enduring Armor Repairer`;

function stores() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  migrateDoctrinesDb(db);
  return { db, fits: createFitStore(db, { now: () => 1000 }), doctrines: createDoctrineStore(db, { now: () => 2000 }) };
}

test('migrateDoctrinesDb creates doctrine tables and indexes', () => {
  const { db } = stores();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('doctrines', 'doctrine_fits') ORDER BY name").all() as Array<{ name: string }>;
  assert.deepEqual(tables.map(row => row.name), ['doctrine_fits', 'doctrines']);

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_doctrines_updated', 'idx_doctrine_fits_doctrine', 'idx_doctrine_fits_fit') ORDER BY name").all() as Array<{ name: string }>;
  assert.deepEqual(indexes.map(row => row.name), ['idx_doctrine_fits_doctrine', 'idx_doctrine_fits_fit', 'idx_doctrines_updated']);
});

test('doctrine store creates updates deletes and preserves saved fits', () => {
  const { db, fits, doctrines } = stores();
  const fit = fits.create({ rawEft: naglfar, fitName: 'Dread DPS' });
  const doctrine = doctrines.create({ name: 'Armor Dread Bomb', description: 'Dreads with carrier support.' });

  const withFit = doctrines.addFit(doctrine.id, fit.id)!;
  assert.equal(withFit.fitCount, 1);
  assert.equal(withFit.fits[0].fitName, 'Dread DPS');
  assert.equal(withFit.fits[0].sortOrder, 1);

  const duplicate = doctrines.addFit(doctrine.id, fit.id)!;
  assert.equal(duplicate.fitCount, 1);
  assert.equal(duplicate.fits[0].sortOrder, 1);

  const updated = doctrines.update(doctrine.id, { name: 'Updated Bomb', description: 'Updated description.' })!;
  assert.equal(updated.name, 'Updated Bomb');
  assert.equal(updated.description, 'Updated description.');

  assert.equal(doctrines.delete(doctrine.id), true);
  assert.equal(fits.get(fit.id)?.fitName, 'Dread DPS');
  const linkCount = db.prepare('SELECT count(*) AS count FROM doctrine_fits').get() as { count: number };
  assert.equal(linkCount.count, 0);
});

test('deleting a saved fit cascades out of doctrine membership', () => {
  const { fits, doctrines } = stores();
  const fit = fits.create({ rawEft: archon, fitName: 'Carrier Support' });
  const doctrine = doctrines.create({ name: 'Carrier Wing' });
  doctrines.addFit(doctrine.id, fit.id);

  assert.equal(doctrines.get(doctrine.id)?.fitCount, 1);
  fits.delete(fit.id);
  assert.equal(doctrines.get(doctrine.id)?.fitCount, 0);
});

test('doctrine search matches name description member ship and member fit name', () => {
  const { fits, doctrines } = stores();
  const dread = fits.create({ rawEft: naglfar, fitName: 'Dread DPS' });
  const carrier = fits.create({ rawEft: archon, fitName: 'Carrier Support' });
  const armor = doctrines.create({ name: 'Armor Dread Bomb', description: 'Escalation comp' });
  const triage = doctrines.create({ name: 'Slowcat Support', description: 'Capital reps' });
  doctrines.addFit(armor.id, dread.id);
  doctrines.addFit(triage.id, carrier.id);

  assert.deepEqual(doctrines.list('bomb').map(row => row.id), [armor.id]);
  assert.deepEqual(doctrines.list('escalation').map(row => row.id), [armor.id]);
  assert.deepEqual(doctrines.list('naglfar').map(row => row.id), [armor.id]);
  assert.deepEqual(doctrines.list('carrier support').map(row => row.id), [triage.id]);
});

test('removeFit leaves doctrine intact when member is absent', () => {
  const { fits, doctrines } = stores();
  const fit = fits.create({ rawEft: naglfar });
  const doctrine = doctrines.create({ name: 'Empty Doctrine' });

  const result = doctrines.removeFit(doctrine.id, fit.id)!;
  assert.equal(result.id, doctrine.id);
  assert.equal(result.fitCount, 0);
});
```

- [ ] **Step 2: Run doctrine store tests and verify RED**

Run:

```bash
node --import tsx --test src/fits/doctrines.test.ts
```

Expected: FAIL because `src/fits/doctrines.ts` does not exist.

- [ ] **Step 3: Implement doctrine migration and store**

Create `src/fits/doctrines.ts`:

```ts
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

interface DoctrineRow {
  id: number;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
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
      const order = (nextOrder.get(doctrineId) as { nextOrder: number }).nextOrder;
      const result = insertFit.run({ doctrineId, fitId, sortOrder: order });
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
```

Modify `src/db.ts`:

```ts
import { migrateDoctrinesDb } from './fits/doctrines.ts';

// existing migrations
migrateContractIndexDb(db);
migrateFitsDb(db);
migrateDoctrinesDb(db);
```

- [ ] **Step 4: Run doctrine store tests and verify GREEN**

Run:

```bash
node --import tsx --test src/fits/doctrines.test.ts
```

Expected: PASS, all doctrine store tests pass.

- [ ] **Step 5: Commit doctrine store**

```bash
git add src/db.ts src/fits/doctrines.ts src/fits/doctrines.test.ts
git commit -m "feat: persist doctrine collections"
```

---

### Task 2: Doctrine API Routes

**Files:**
- Create: `src/routes/doctrines.ts`
- Create: `src/routes/doctrines.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `createDoctrineStore(db)` and `DoctrineStore`.
- Produces:
  - `registerDoctrineRoutes(app: FastifyInstance, deps?: { store?: DoctrineStore }): void`
  - HTTP endpoints from the approved spec under `/api/doctrines`.

- [ ] **Step 1: Write failing doctrine route tests**

Create `src/routes/doctrines.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createFitStore, migrateFitsDb } from '../fits/store.ts';
import { createDoctrineStore, migrateDoctrinesDb } from '../fits/doctrines.ts';
import { registerDoctrineRoutes } from './doctrines.ts';

const naglfar = `[Naglfar, Route Dread]
Republic Fleet Gyrostabilizer
Siege Module II`;

function appWithStores() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  migrateDoctrinesDb(db);
  const fits = createFitStore(db);
  const store = createDoctrineStore(db);
  const app = Fastify();
  registerDoctrineRoutes(app, { store });
  return { app, fits, store };
}

test('doctrine CRUD routes create list get update and delete', async () => {
  const { app } = appWithStores();

  const created = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: 'Armor Bomb', description: 'Dread comp' } });
  assert.equal(created.statusCode, 200);
  const doctrine = JSON.parse(created.body);
  assert.equal(doctrine.name, 'Armor Bomb');

  const list = await app.inject({ method: 'GET', url: '/api/doctrines?q=dread' });
  assert.equal(JSON.parse(list.body)[0].id, doctrine.id);

  const got = await app.inject({ method: 'GET', url: `/api/doctrines/${doctrine.id}` });
  assert.equal(JSON.parse(got.body).description, 'Dread comp');

  const updated = await app.inject({ method: 'PUT', url: `/api/doctrines/${doctrine.id}`, payload: { name: 'Updated Bomb', description: 'Updated' } });
  assert.equal(JSON.parse(updated.body).name, 'Updated Bomb');

  const deleted = await app.inject({ method: 'DELETE', url: `/api/doctrines/${doctrine.id}` });
  assert.equal(deleted.statusCode, 200);
  assert.equal(JSON.parse(deleted.body).ok, true);
});

test('doctrine routes add and remove saved fits', async () => {
  const { app, fits } = appWithStores();
  const fit = fits.create({ rawEft: naglfar, fitName: 'Route Dread DPS' });
  const created = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: 'Route Doctrine' } });
  const doctrine = JSON.parse(created.body);

  const added = await app.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/fits`, payload: { fitId: fit.id } });
  assert.equal(added.statusCode, 200);
  assert.equal(JSON.parse(added.body).fits[0].fitName, 'Route Dread DPS');

  const duplicate = await app.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/fits`, payload: { fitId: fit.id } });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(JSON.parse(duplicate.body).fitCount, 1);

  const removed = await app.inject({ method: 'DELETE', url: `/api/doctrines/${doctrine.id}/fits/${fit.id}` });
  assert.equal(removed.statusCode, 200);
  assert.equal(JSON.parse(removed.body).fitCount, 0);
});

test('doctrine routes validate blank names invalid ids missing doctrine and missing fit', async () => {
  const { app } = appWithStores();

  const blank = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: '   ' } });
  assert.equal(blank.statusCode, 400);

  const invalid = await app.inject({ method: 'GET', url: '/api/doctrines/nope' });
  assert.equal(invalid.statusCode, 400);

  const missingDoctrine = await app.inject({ method: 'GET', url: '/api/doctrines/99999' });
  assert.equal(missingDoctrine.statusCode, 404);

  const created = await app.inject({ method: 'POST', url: '/api/doctrines', payload: { name: 'Missing Fit Test' } });
  const doctrine = JSON.parse(created.body);
  const missingFit = await app.inject({ method: 'POST', url: `/api/doctrines/${doctrine.id}/fits`, payload: { fitId: 99999 } });
  assert.equal(missingFit.statusCode, 404);
});
```

- [ ] **Step 2: Run doctrine route tests and verify RED**

Run:

```bash
node --import tsx --test src/routes/doctrines.test.ts
```

Expected: FAIL because `src/routes/doctrines.ts` does not exist.

- [ ] **Step 3: Implement doctrine routes**

Create `src/routes/doctrines.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { db } from '../db.ts';
import { createDoctrineStore, type DoctrineStore } from '../fits/doctrines.ts';

export interface DoctrineRouteDeps {
  store?: DoctrineStore;
}

export function registerDoctrineRoutes(app: FastifyInstance, deps: DoctrineRouteDeps = {}) {
  const store = deps.store ?? createDoctrineStore(db);

  app.get('/api/doctrines', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '');
    return store.list(q);
  });

  app.post('/api/doctrines', async (req, reply) => {
    const body = req.body as { name?: string; description?: string } | undefined;
    if (!body?.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      return store.create({ name: body.name, description: body.description });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to create doctrine') });
    }
  });

  app.get('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const doctrine = store.get(id);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    return doctrine;
  });

  app.put('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const body = req.body as { name?: string; description?: string } | undefined;
    if (body?.name != null && !body.name.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      const doctrine = store.update(id, { name: body?.name, description: body?.description });
      if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
      return doctrine;
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to update doctrine') });
    }
  });

  app.delete('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    if (!store.delete(id)) return reply.code(404).send({ error: 'doctrine not found' });
    return { ok: true };
  });

  app.post('/api/doctrines/:id/fits', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const fitId = cleanPositiveNumber((req.body as { fitId?: number } | undefined)?.fitId);
    if (!fitId) return reply.code(400).send({ error: 'fitId is required' });
    try {
      const doctrine = store.addFit(id, fitId);
      if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
      return doctrine;
    } catch (err) {
      if (errorMessage(err, '').includes('Saved fit not found')) return reply.code(404).send({ error: 'saved fit not found' });
      return reply.code(400).send({ error: errorMessage(err, 'failed to add fit') });
    }
  });

  app.delete('/api/doctrines/:id/fits/:fitId', async (req, reply) => {
    const id = parseId(req.params);
    const fitId = cleanPositiveNumber((req.params as { fitId?: string }).fitId);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    if (!fitId) return reply.code(400).send({ error: 'valid fit id is required' });
    const doctrine = store.removeFit(id, fitId);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    return doctrine;
  });
}

function parseId(params: unknown): number | null {
  return cleanPositiveNumber((params as { id?: string })?.id) ?? null;
}

function cleanPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
```

Modify `src/server.ts`:

```ts
import { registerDoctrineRoutes } from './routes/doctrines.ts';

// after registerFitRoutes(app);
registerFitRoutes(app);
registerDoctrineRoutes(app);
```

- [ ] **Step 4: Run doctrine route tests and verify GREEN**

Run:

```bash
node --import tsx --test src/routes/doctrines.test.ts
```

Expected: PASS, all doctrine route tests pass.

- [ ] **Step 5: Commit doctrine routes**

```bash
git add src/routes/doctrines.ts src/routes/doctrines.test.ts src/server.ts
git commit -m "feat: add doctrine api"
```

---

### Task 3: Frontend Doctrine API Helpers

**Files:**
- Modify: `web/src/api.ts`
- Create: `src/fits/doctrine-view.test.ts`

**Interfaces:**
- Consumes: `/api/doctrines` route response shapes from Task 2.
- Produces:
  - `DoctrineSummary`
  - `DoctrineFitMember`
  - `DoctrineDetail`
  - `fetchDoctrines(q?: string): Promise<DoctrineSummary[]>`
  - `fetchDoctrine(id: number): Promise<DoctrineDetail | { error: string }>`
  - `createDoctrine(input: { name: string; description?: string }): Promise<DoctrineDetail | { error: string }>`
  - `updateDoctrine(id: number, input: { name?: string; description?: string }): Promise<DoctrineDetail | { error: string }>`
  - `deleteDoctrine(id: number): Promise<{ ok: true } | { error: string }>`
  - `addDoctrineFit(id: number, fitId: number): Promise<DoctrineDetail | { error: string }>`
  - `removeDoctrineFit(id: number, fitId: number): Promise<DoctrineDetail | { error: string }>`

- [ ] **Step 1: Write failing frontend API guard**

Create `src/fits/doctrine-view.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('frontend exposes doctrine api helpers and doctrine view controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');
  const switchView = readFileSync(resolve('web/src/components/FitModeSwitch.tsx'), 'utf8');

  assert.match(api, /export interface DoctrineSummary/);
  assert.match(api, /export interface DoctrineDetail/);
  assert.match(api, /export async function fetchDoctrines/);
  assert.match(api, /export async function addDoctrineFit/);
  assert.match(api, /export async function removeDoctrineFit/);

  assert.match(fitsView, /DoctrinesView/);
  assert.match(switchView, /Fits/);
  assert.match(switchView, /Doctrines/);
  assert.match(doctrinesView, /Search doctrines/);
  assert.match(doctrinesView, /Create doctrine/);
  assert.match(doctrinesView, /Add fit/);
  assert.match(doctrinesView, /Remove/);
});
```

- [ ] **Step 2: Run frontend guard and verify RED**

Run:

```bash
node --import tsx --test src/fits/doctrine-view.test.ts
```

Expected: FAIL because `DoctrinesView.tsx` and `FitModeSwitch.tsx` do not exist and `web/src/api.ts` lacks doctrine helpers.

- [ ] **Step 3: Add doctrine API types and helpers**

Modify `web/src/api.ts` near the Fits types:

```ts
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

export async function fetchDoctrines(q = ''): Promise<DoctrineSummary[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const res = await fetch(`/api/doctrines${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDoctrine(id: number): Promise<DoctrineDetail | { error: string }> {
  const res = await fetch(`/api/doctrines/${id}`);
  return jsonOrError<DoctrineDetail>(res);
}

export async function createDoctrine(input: { name: string; description?: string }): Promise<DoctrineDetail | { error: string }> {
  const res = await fetch('/api/doctrines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrError<DoctrineDetail>(res);
}

export async function updateDoctrine(id: number, input: { name?: string; description?: string }): Promise<DoctrineDetail | { error: string }> {
  const res = await fetch(`/api/doctrines/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrError<DoctrineDetail>(res);
}

export async function deleteDoctrine(id: number): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(`/api/doctrines/${id}`, { method: 'DELETE' });
  return jsonOrError<{ ok: true }>(res);
}

export async function addDoctrineFit(id: number, fitId: number): Promise<DoctrineDetail | { error: string }> {
  const res = await fetch(`/api/doctrines/${id}/fits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fitId }),
  });
  return jsonOrError<DoctrineDetail>(res);
}

export async function removeDoctrineFit(id: number, fitId: number): Promise<DoctrineDetail | { error: string }> {
  const res = await fetch(`/api/doctrines/${id}/fits/${fitId}`, { method: 'DELETE' });
  return jsonOrError<DoctrineDetail>(res);
}
```

- [ ] **Step 4: Run frontend guard and verify current failure moves to missing UI files**

Run:

```bash
node --import tsx --test src/fits/doctrine-view.test.ts
```

Expected: FAIL because `DoctrinesView.tsx` and `FitModeSwitch.tsx` still do not exist.

- [ ] **Step 5: Commit frontend API helpers**

```bash
git add web/src/api.ts src/fits/doctrine-view.test.ts
git commit -m "feat: add doctrine frontend api"
```

---

### Task 4: Doctrine UI Inside Fits

**Files:**
- Create: `web/src/components/FitModeSwitch.tsx`
- Create: `web/src/components/DoctrinesView.tsx`
- Modify: `web/src/components/FitsView.tsx`
- Modify: `web/src/styles.css`
- Test: `src/fits/doctrine-view.test.ts`

**Interfaces:**
- Consumes: frontend doctrine API helpers from Task 3 and existing `SavedFitSummary` from `web/src/api.ts`.
- Produces:
  - `FitModeSwitch({ mode, onMode })`
  - `DoctrinesView({ mode, onMode })`
  - `FitsView` wrapper with `Fits | Doctrines` internal mode.

- [ ] **Step 1: Create the mode switch component**

Create `web/src/components/FitModeSwitch.tsx`:

```tsx
export type FitMode = 'fits' | 'doctrines';

export function FitModeSwitch({ mode, onMode }: { mode: FitMode; onMode: (mode: FitMode) => void }) {
  return (
    <div className="fits-mode-switch" role="tablist" aria-label="Fits section">
      <button className={mode === 'fits' ? 'active' : ''} onClick={() => onMode('fits')} role="tab" aria-selected={mode === 'fits'}>
        Fits
      </button>
      <button className={mode === 'doctrines' ? 'active' : ''} onClick={() => onMode('doctrines')} role="tab" aria-selected={mode === 'doctrines'}>
        Doctrines
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create doctrine view component**

Create `web/src/components/DoctrinesView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  addDoctrineFit,
  createDoctrine,
  deleteDoctrine,
  fetchDoctrine,
  fetchDoctrines,
  fetchFits,
  removeDoctrineFit,
  updateDoctrine,
  type DoctrineDetail,
  type DoctrineSummary,
  type SavedFitSummary,
} from '../api.ts';
import { FitModeSwitch, type FitMode } from './FitModeSwitch.tsx';

interface Props {
  mode: FitMode;
  onMode: (mode: FitMode) => void;
}

function iconUrl(typeId: number): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

function warningCount(fit: SavedFitSummary): number {
  return fit.warningCounts.unmatched + fit.warningCounts.overSlot + fit.warningCounts.unassignable;
}

export function DoctrinesView({ mode, onMode }: Props) {
  const [query, setQuery] = useState('');
  const [doctrines, setDoctrines] = useState<DoctrineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DoctrineDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fitQuery, setFitQuery] = useState('');
  const [savedFits, setSavedFits] = useState<SavedFitSummary[]>([]);

  async function reloadList(q = query) {
    const rows = await fetchDoctrines(q);
    setDoctrines(rows);
    if (selectedId == null && rows.length > 0) setSelectedId(rows[0].id);
  }

  useEffect(() => { reloadList(); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => reloadList(query), 150);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    fetchFits().then(setSavedFits).catch(() => setSavedFits([]));
  }, []);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    fetchDoctrine(selectedId).then(res => {
      if ('error' in res) setDetail(null);
      else setDetail(res);
    });
  }, [selectedId]);

  useEffect(() => {
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
    setStatus(null);
  }, [detail?.id]);

  const availableFits = useMemo(() => {
    const q = fitQuery.trim().toLowerCase();
    const used = new Set(detail?.fits.map(fit => fit.id) ?? []);
    return savedFits
      .filter(fit => !used.has(fit.id))
      .filter(fit => !q || `${fit.shipName} ${fit.fitName}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [savedFits, fitQuery, detail?.fits]);

  async function createNewDoctrine() {
    setBusy(true);
    const res = await createDoctrine({ name: 'New Doctrine', description: '' });
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setSelectedId(res.id);
    setDetail(res);
    await reloadList('');
    setQuery('');
  }

  async function saveDoctrine() {
    if (!detail) return;
    setBusy(true);
    const res = await updateDoctrine(detail.id, { name, description });
    setBusy(false);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    setStatus('Saved.');
    await reloadList();
  }

  async function removeDoctrine() {
    if (!detail) return;
    if (!confirm('Delete this doctrine? Saved fits will not be deleted.')) return;
    const res = await deleteDoctrine(detail.id);
    if ('error' in res) { setStatus(res.error); return; }
    setSelectedId(null);
    setDetail(null);
    await reloadList();
  }

  async function addFit(fitId: number) {
    if (!detail) return;
    const res = await addDoctrineFit(detail.id, fitId);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    setFitQuery('');
    await reloadList();
  }

  async function removeFit(fitId: number) {
    if (!detail) return;
    const res = await removeDoctrineFit(detail.id, fitId);
    if ('error' in res) { setStatus(res.error); return; }
    setDetail(res);
    await reloadList();
  }

  return (
    <main className="rows-wrap fits-view">
      <aside className="fits-library doctrine-library">
        <FitModeSwitch mode={mode} onMode={onMode} />
        <div className="fits-lib-head">
          <strong>Doctrines</strong>
          <button className="fl-refresh" onClick={createNewDoctrine} disabled={busy}>Create doctrine</button>
        </div>
        <input className="fits-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search doctrines" />
        <div className="fits-list">
          {doctrines.map(row => (
            <button key={row.id} className={`fits-row${selectedId === row.id ? ' active' : ''}`} onClick={() => setSelectedId(row.id)}>
              <span className="fits-row-ship">{row.name}</span>
              <span className="fits-row-name">{row.description || row.shipNames.join(', ') || 'No description'}</span>
              <span className="fits-row-meta">{row.fitCount} fits</span>
            </button>
          ))}
          {doctrines.length === 0 && <div className="fits-empty">Create a doctrine from saved fits.</div>}
        </div>
      </aside>

      <section className="fits-detail doctrine-detail">
        {!detail && <div className="fits-empty large">Create a doctrine from saved fits.</div>}
        {detail && (
          <>
            <div className="doctrine-head">
              <div className="doctrine-fields">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Doctrine name" />
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description of how this doctrine works" />
              </div>
              <div className="fits-actions">
                <button onClick={saveDoctrine} disabled={busy}>Save</button>
                <button className="danger" onClick={removeDoctrine}>Delete</button>
                {status && <small className={status === 'Saved.' ? 'fits-status ok' : 'fits-status err'}>{status}</small>}
              </div>
            </div>

            <section className="doctrine-add">
              <h3>Add fit</h3>
              <input value={fitQuery} onChange={e => setFitQuery(e.target.value)} placeholder="Search saved fits by ship or fit name" />
              {fitQuery.trim() && (
                <div className="doctrine-fit-results">
                  {availableFits.map(fit => (
                    <button key={fit.id} onClick={() => addFit(fit.id)}>
                      <img src={iconUrl(fit.shipTypeId)} alt="" />
                      <span><b>{fit.shipName}</b><small>{fit.fitName}</small></span>
                    </button>
                  ))}
                  {availableFits.length === 0 && <div className="fits-empty">No saved fits found.</div>}
                </div>
              )}
            </section>

            <section className="doctrine-members">
              <h3>Fits <span>{detail.fitCount}</span></h3>
              <div className="doctrine-member-grid">
                {detail.fits.map(fit => (
                  <div className="doctrine-member" key={fit.id}>
                    <img src={iconUrl(fit.shipTypeId)} alt="" />
                    <div>
                      <strong>{fit.shipName}</strong>
                      <span>{fit.fitName}</span>
                      {warningCount(fit) > 0 && <small>{warningCount(fit)} warnings</small>}
                    </div>
                    <button onClick={() => removeFit(fit.id)}>Remove</button>
                  </div>
                ))}
                {detail.fits.length === 0 && <div className="fits-empty">No fits in this doctrine yet.</div>}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Wrap existing FitsView with mode switching**

Modify `web/src/components/FitsView.tsx`:

```tsx
import { DoctrinesView } from './DoctrinesView.tsx';
import { FitModeSwitch, type FitMode } from './FitModeSwitch.tsx';

const FITS_MODE_KEY = 'efd.fits.mode';

export function FitsView({ chars }: Props) {
  const [mode, setMode] = useState<FitMode>(() => (localStorage.getItem(FITS_MODE_KEY) as FitMode) || 'fits');
  useEffect(() => { localStorage.setItem(FITS_MODE_KEY, mode); }, [mode]);
  if (mode === 'doctrines') return <DoctrinesView mode={mode} onMode={setMode} />;
  return <SavedFitsView chars={chars} mode={mode} onMode={setMode} />;
}

function SavedFitsView({ chars, mode, onMode }: Props & { mode: FitMode; onMode: (mode: FitMode) => void }) {
  // existing saved-fit state, effects, handlers, and return markup remain here
}
```

Perform this edit mechanically:

- Rename the current exported `FitsView` function to `SavedFitsView`.
- Change the renamed function signature to `function SavedFitsView({ chars, mode, onMode }: Props & { mode: FitMode; onMode: (mode: FitMode) => void })`.
- Add the new exported `FitsView` wrapper shown above before `SavedFitsView`.
- Add `<FitModeSwitch mode={mode} onMode={onMode} />` as the first child inside the saved-fit left pane `<aside className="fits-library">`.
- Preserve all current saved-fit behavior, including import, save, copy EFT, send, pricing, tooltip, and mismatch modal.

- [ ] **Step 4: Add doctrine styling**

Modify `web/src/styles.css`:

```css
.fits-mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 2px;
  background: #11141a;
  border: 1px solid var(--border);
  border-radius: 5px;
}
.fits-mode-switch button {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dim);
  padding: 7px 9px;
  font: inherit;
  cursor: pointer;
}
.fits-mode-switch button.active {
  background: var(--accent);
  color: #0b0e13;
  font-weight: 700;
}
.doctrine-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.doctrine-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.doctrine-fields input,
.doctrine-fields textarea,
.doctrine-add input {
  width: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  font: inherit;
}
.doctrine-fields textarea {
  min-height: 94px;
  resize: vertical;
}
.doctrine-add,
.doctrine-members {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
}
.doctrine-add h3,
.doctrine-members h3 {
  margin: 0;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
}
.doctrine-add input {
  margin: 10px;
  width: calc(100% - 20px);
}
.doctrine-fit-results {
  display: grid;
  gap: 4px;
  padding: 0 10px 10px;
}
.doctrine-fit-results button,
.doctrine-member {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: #11141a;
  color: var(--text);
  text-align: left;
}
.doctrine-fit-results img,
.doctrine-member img {
  width: 38px;
  height: 38px;
  border-radius: 4px;
}
.doctrine-fit-results span,
.doctrine-member div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.doctrine-fit-results small,
.doctrine-member span,
.doctrine-member small {
  color: var(--dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doctrine-member-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
  padding: 10px;
}
```

- [ ] **Step 5: Run frontend guard and verify GREEN**

Run:

```bash
node --import tsx --test src/fits/doctrine-view.test.ts
```

Expected: PASS, the structural doctrine UI/API guard passes.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit doctrine UI**

```bash
git add web/src/components/FitModeSwitch.tsx web/src/components/DoctrinesView.tsx web/src/components/FitsView.tsx web/src/styles.css src/fits/doctrine-view.test.ts
git commit -m "feat: add doctrine dashboard"
```

---

### Task 5: End-To-End Verification And Local Smoke

**Files:**
- Modify only if verification exposes a bug.

**Interfaces:**
- Consumes all deliverables from Tasks 1-4.
- Produces verified doctrine functionality on local `main` or the active feature branch.

- [ ] **Step 1: Run full serial test suite**

Run:

```bash
npm test -- --test-concurrency=1
```

Expected: PASS, all tests pass. Use serial mode because this repo has existing SQLite contention in parallel Node tests.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS, Vite builds the frontend.

- [ ] **Step 3: Start local app**

Run:

```bash
npm run dev
```

Expected: backend listens on `http://127.0.0.1:3100` and Vite listens on `http://localhost:5173`.

- [ ] **Step 4: Browser smoke test doctrine workflow**

Open `http://localhost:5173`, go to `Fits`, switch to `Doctrines`, and verify:

- Create doctrine.
- Rename it.
- Add a description.
- Search saved fits and add one.
- Search doctrines by doctrine name.
- Search doctrines by description.
- Search doctrines by member ship name.
- Search doctrines by member fit name.
- Remove the member fit.
- Confirm doctrine remains empty.
- Delete the doctrine.
- Switch back to `Fits` and confirm saved-fit behavior still renders.

- [ ] **Step 5: Commit verification fixes if needed**

If smoke testing exposes a bug, fix it in the relevant task file, rerun the failed verification command, then commit the exact edited files with a descriptive `fix:` message. If no bugs were found, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: Tasks 1-2 cover data model, store, API, cascades, duplicate add, and missing row behavior. Tasks 3-4 cover API helpers and the Fits-tab `Fits | Doctrines` UI. Task 5 covers full verification and local smoke.
- Scope check: This plan stays within V1. It does not add roles, quantities, doctrine price totals, whole-doctrine export, draft-fit import into doctrines, sharing, assignments, or drag-and-drop reordering.
- Type consistency: Backend uses `DoctrineSummary`, `DoctrineDetail`, and `DoctrineFitMember`; frontend mirrors those names. Membership APIs use `fitId` consistently.
