import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createFitStore, migrateFitsDb } from '../fits/store.ts';
import { registerFitRoutes } from './fits.ts';
import type { FitDraft } from '../fits/types.ts';
import type { FitQuote } from '../fits/pricing.ts';
import type { EsiFittingCreatePayload } from '../fits/esi.ts';

const naglfar = `[Naglfar, Route Test]
Republic Fleet Gyrostabilizer

Pithum C-Type Multispectrum Shield Hardener

Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x10`;

function testStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  return createFitStore(db);
}

const ownedPilotDeps = {
  currentUser: async () => ({ id: 'user-1', email: null, role: 'user' as const, status: 'active' as const }),
  ownsCharacter: () => true,
};

test('POST /api/fits/preview returns a draft with unmatched warnings', async () => {
  const app = Fastify();
  registerFitRoutes(app, { store: testStore() });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/preview',
    payload: { rawEft: `${naglfar}\nDefinitely Not A Real Module` },
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as FitDraft;
  assert.equal(body.ship?.name, 'Naglfar');
  assert.equal(body.warnings.some(w => w.code === 'unmatched-item'), true);
});

test('saved fit CRUD routes create list get update and delete', async () => {
  const app = Fastify();
  registerFitRoutes(app, { store: testStore() });

  const created = await app.inject({
    method: 'POST',
    url: '/api/fits',
    payload: { rawEft: naglfar, fitName: 'Saved Route Fit', notes: 'route note' },
  });
  assert.equal(created.statusCode, 200);
  const saved = JSON.parse(created.body);
  assert.equal(saved.fitName, 'Saved Route Fit');

  const list = await app.inject({ method: 'GET', url: '/api/fits' });
  assert.equal(JSON.parse(list.body)[0].fitName, 'Saved Route Fit');

  const got = await app.inject({ method: 'GET', url: `/api/fits/${saved.id}` });
  assert.equal(JSON.parse(got.body).notes, 'route note');

  const updated = await app.inject({
    method: 'PUT',
    url: `/api/fits/${saved.id}`,
    payload: { fitName: 'Updated Route Fit', notes: 'updated' },
  });
  assert.equal(JSON.parse(updated.body).fitName, 'Updated Route Fit');

  const deleted = await app.inject({ method: 'DELETE', url: `/api/fits/${saved.id}` });
  assert.equal(deleted.statusCode, 200);
  assert.equal(JSON.parse(deleted.body).ok, true);
});

test('quote route delegates saved fit pricing with hub validation', async () => {
  const app = Fastify();
  const store = testStore();
  const saved = store.create({ rawEft: naglfar });
  registerFitRoutes(app, {
    store,
    quoteFit: async (fit, hub): Promise<FitQuote> => ({
      hub,
      systemName: 'Jita',
      regionName: 'The Forge',
      items: [],
      totalCost: 42,
      counts: { ok: 0, partial: 0, noOrders: 0, unknown: 0 },
      fetchedAt: 123,
      totals: { hull: 10, fitted: 20, extras: 12, grand: fit.ship ? 42 : 0 },
    }),
  });

  const bad = await app.inject({ method: 'POST', url: `/api/fits/${saved.id}/quote`, payload: { hub: 'dodixie' } });
  assert.equal(bad.statusCode, 400);

  const res = await app.inject({ method: 'POST', url: `/api/fits/${saved.id}/quote`, payload: { hub: 'jita' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).totals.grand, 42);
});

test('send route creates an in-game fitting and reports excluded rows', async () => {
  const app = Fastify();
  const store = testStore();
  const saved = store.create({ rawEft: `${naglfar}\nDefinitely Not A Real Module` });
  const observed: EsiFittingCreatePayload[] = [];
  registerFitRoutes(app, {
    store,
    ...ownedPilotDeps,
    createFitting: async (_characterId, payload) => {
      observed.push(payload);
      return 12345;
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: `/api/fits/${saved.id}/send`,
    payload: { characterId: 90000001 },
  });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.fittingId, 12345);
  assert.equal(body.excludedCount, 1);
  assert.equal(observed[0]?.ship_type_id, 19722);
});

test('send route returns a reauth hint for missing fitting scope', async () => {
  const app = Fastify();
  const store = testStore();
  const saved = store.create({ rawEft: naglfar });
  registerFitRoutes(app, {
    store,
    ...ownedPilotDeps,
    createFitting: async () => {
      const err = new Error('forbidden') as Error & { status: number; body: string };
      err.status = 403;
      err.body = 'missing scope esi-fittings.write_fittings.v1';
      throw err;
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: `/api/fits/${saved.id}/send`,
    payload: { characterId: 90000001 },
  });
  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).reauthHint, /esi-fittings\.write_fittings\.v1/);
});
