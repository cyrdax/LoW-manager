import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createFitStore, migrateFitsDb } from '../fits/store.ts';
import { registerFitRoutes } from './fits.ts';
import type { FitDraft } from '../fits/types.ts';
import type { FitQuote } from '../fits/pricing.ts';
import type { EsiFittingCreatePayload } from '../fits/esi.ts';
import {
  DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES,
  PYFA_IMAGE_IMPORT_NOT_CONFIGURED,
  type PyfaScreenshotExtractor,
} from '../fits/pyfa-image-import.ts';

const naglfar = `[Naglfar, Route Test]
Republic Fleet Gyrostabilizer

Pithum C-Type Multispectrum Shield Hardener

Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x10`;

const editorJson = {
  version: 1,
  hull: { typeId: 19720, name: 'Naglfar', groupId: 485, groupName: 'Dreadnought' },
  fitName: 'Route Editor Fit',
  notes: '',
  skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
  items: [
    {
      editorItemId: 'high-0',
      typeId: 3542,
      name: 'Siege Module II',
      role: 'high',
      quantity: 1,
      slotIndex: 0,
      state: 'offline',
      chargeTypeId: null,
      chargeName: null,
    },
  ],
} as const;

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

const userA = { id: 'user-a', email: null, role: 'user' as const, status: 'active' as const };
const userB = { id: 'user-b', email: null, role: 'user' as const, status: 'active' as const };

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

test('GET /api/fits/items returns catalog item suggestions for Fits v2', async () => {
  const app = Fastify();
  registerFitRoutes(app, {
    store: testStore(),
    searchItems: (q, limit) => {
      assert.equal(q, 'laser');
      assert.equal(limit, 30);
      return [{
        typeId: 3000,
        name: 'Mega Pulse Laser II',
        groupId: 53,
        groupName: 'Energy Weapon',
        categoryId: 7,
        categoryName: 'Module',
        role: null,
      }];
    },
  });

  const res = await app.inject({ method: 'GET', url: '/api/fits/items?q=laser' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), [{
    id: 3000,
    name: 'Mega Pulse Laser II',
    groupName: 'Energy Weapon',
    categoryName: 'Module',
    role: null,
  }]);
});

test('GET /api/fits/ships returns complete hull metadata for Fits v2', async () => {
  const app = Fastify();
  registerFitRoutes(app, {
    store: testStore(),
    searchShips: (q, limit) => {
      assert.equal(q, 'nag');
      assert.equal(limit, 20);
      return [{
        typeId: 19720,
        name: 'Naglfar',
        groupId: 485,
        groupName: 'Dreadnought',
      }];
    },
  });

  const res = await app.inject({ method: 'GET', url: '/api/fits/ships?q=nag' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), [{
    id: 19720,
    name: 'Naglfar',
    groupId: 485,
    groupName: 'Dreadnought',
    highSlots: 5,
    midSlots: 4,
    lowSlots: 8,
    rigSlots: 3,
    serviceSlots: 0,
    subsystemSlots: 0,
  }]);
});

test('raw EFT routes reject oversized imports before parsing', async () => {
  const oversized = `[Naglfar, Oversized]\n${'Hail XL\n'.repeat(9000)}`;
  let previewBuilds = 0;
  const store = testStore();
  const saved = store.create({ rawEft: naglfar, ownerUserId: userA.id });
  const app = Fastify();
  registerFitRoutes(app, {
    store,
    currentUser: async () => userA,
    ownsCharacter: () => true,
    buildDraft: raw => {
      previewBuilds++;
      throw new Error(`should not parse ${raw.length}`);
    },
  });

  for (const request of [
    { method: 'POST' as const, url: '/api/fits/preview', payload: { rawEft: oversized } },
    { method: 'POST' as const, url: '/api/fits/quote-draft', payload: { rawEft: oversized, hub: 'jita' } },
    { method: 'POST' as const, url: '/api/fits/send-draft', payload: { rawEft: oversized, characterId: 123 } },
    { method: 'POST' as const, url: '/api/fits', payload: { rawEft: oversized } },
    { method: 'PUT' as const, url: `/api/fits/${saved.id}`, payload: { rawEft: oversized } },
  ]) {
    const res = await app.inject(request);
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /too large/i);
  }

  assert.equal(previewBuilds, 0);
});

test('pyfa image import route requires an authenticated app user', async () => {
  const app = Fastify();
  registerFitRoutes(app, {
    store: testStore(),
    currentUser: async () => null,
    pyfaScreenshotExtractor: {
      extract: async () => {
        throw new Error('should not extract without auth');
      },
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/import-pyfa-image',
    payload: { imageBase64: 'AAAA', mimeType: 'image/png' },
  });

  assert.equal(res.statusCode, 401);
});

test('pyfa image import route validates image input before extraction', async () => {
  const app = Fastify();
  let calls = 0;
  registerFitRoutes(app, {
    store: testStore(),
    currentUser: async () => userA,
    pyfaScreenshotExtractor: {
      extract: async () => {
        calls++;
        throw new Error('should not extract invalid images');
      },
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/import-pyfa-image',
    payload: { imageBase64: 'AAAA', mimeType: 'image/gif' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /unsupported image type/i);
  assert.equal(calls, 0);
});

test('pyfa image import route returns generated EFT text and warnings', async () => {
  const app = Fastify();
  const extractor: PyfaScreenshotExtractor = {
    extract: async input => {
      assert.equal(input.userId, 'user-a');
      assert.equal(input.mimeType, 'image/png');
      return {
        shipName: 'Paladin',
        fitName: 'Fabricator',
        warnings: ['Visible additions may be incomplete.'],
        sections: [{ role: 'high', items: [{ name: 'Mega Pulse Laser II', loadedCharge: 'Conflagration L' }] }],
      };
    },
  };
  registerFitRoutes(app, { store: testStore(), currentUser: async () => userA, pyfaScreenshotExtractor: extractor });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/import-pyfa-image',
    payload: { imageBase64: 'AAAA', mimeType: 'image/png' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    rawEft: [
      '[Paladin, Fabricator]',
      '',
      '[Empty Low slot]',
      '',
      '[Empty Med slot]',
      '',
      'Mega Pulse Laser II, Conflagration L',
      '',
      '[Empty Rig slot]',
    ].join('\n'),
    warnings: ['Visible additions may be incomplete.'],
  });
});

test('pyfa image import route accepts clipboard screenshots above the default Fastify body limit', async () => {
  const app = Fastify();
  let calls = 0;
  registerFitRoutes(app, {
    store: testStore(),
    currentUser: async () => userA,
    pyfaScreenshotExtractor: {
      extract: async () => {
        calls++;
        return {
          shipName: 'Paladin',
          fitName: 'Clipboard',
          warnings: [],
          sections: [{ role: 'high', items: [{ name: 'Mega Pulse Laser II' }] }],
        };
      },
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/import-pyfa-image',
    payload: {
      imageBase64: Buffer.alloc(1_100_000).toString('base64'),
      mimeType: 'image/png',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls, 1);
  assert.match(JSON.parse(res.body).rawEft, /\[Paladin, Clipboard\]/);
});

test('pyfa image import route still rejects decoded images above the pyfa limit', async () => {
  const app = Fastify();
  let calls = 0;
  registerFitRoutes(app, {
    store: testStore(),
    currentUser: async () => userA,
    pyfaScreenshotExtractor: {
      extract: async () => {
        calls++;
        throw new Error('should not extract oversized images');
      },
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/import-pyfa-image',
    payload: {
      imageBase64: Buffer.alloc(DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES + 1).toString('base64'),
      mimeType: 'image/png',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /image is too large/i);
  assert.equal(calls, 0);
});

test('pyfa image import route reports provider configuration errors clearly', async () => {
  const app = Fastify();
  registerFitRoutes(app, {
    store: testStore(),
    currentUser: async () => userA,
    pyfaScreenshotExtractor: {
      extract: async () => {
        throw new Error(PYFA_IMAGE_IMPORT_NOT_CONFIGURED);
      },
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fits/import-pyfa-image',
    payload: { imageBase64: 'AAAA', mimeType: 'image/png' },
  });

  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, PYFA_IMAGE_IMPORT_NOT_CONFIGURED);
});

test('saved fit CRUD routes create list get update and delete', async () => {
  const app = Fastify();
  registerFitRoutes(app, { store: testStore(), currentUser: async () => userA });

  const created = await app.inject({
    method: 'POST',
    url: '/api/fits',
    payload: { rawEft: naglfar, fitName: 'Saved Route Fit', notes: 'route note', editorJson },
  });
  assert.equal(created.statusCode, 200);
  const saved = JSON.parse(created.body);
  assert.equal(saved.fitName, 'Saved Route Fit');
  assert.equal(saved.editorJson.fitName, 'Route Editor Fit');

  const list = await app.inject({ method: 'GET', url: '/api/fits' });
  assert.equal(JSON.parse(list.body)[0].fitName, 'Saved Route Fit');
  assert.equal(JSON.parse(list.body)[0].hasEditorJson, true);

  const got = await app.inject({ method: 'GET', url: `/api/fits/${saved.id}` });
  assert.equal(JSON.parse(got.body).notes, 'route note');
  assert.equal(JSON.parse(got.body).editorJson.items[0].name, 'Siege Module II');

  const updated = await app.inject({
    method: 'PUT',
    url: `/api/fits/${saved.id}`,
    payload: { fitName: 'Updated Route Fit', notes: 'updated', editorJson: { ...editorJson, fitName: 'Updated Editor' } },
  });
  assert.equal(JSON.parse(updated.body).fitName, 'Updated Route Fit');
  assert.equal(JSON.parse(updated.body).editorJson.fitName, 'Updated Editor');

  const invalid = await app.inject({
    method: 'PUT',
    url: `/api/fits/${saved.id}`,
    payload: { editorJson: { ...editorJson, version: 2 } },
  });
  assert.equal(invalid.statusCode, 400);
  assert.match(JSON.parse(invalid.body).error, /editorJson/i);

  const deleted = await app.inject({ method: 'DELETE', url: `/api/fits/${saved.id}` });
  assert.equal(deleted.statusCode, 200);
  assert.equal(JSON.parse(deleted.body).ok, true);
});

test('fit routes scope private libraries and let public fits be copied privately', async () => {
  const store = testStore();
  const privateFit = store.create({ rawEft: naglfar, fitName: 'Private A', ownerUserId: 'user-a', visibility: 'private' });
  const publicFit = store.create({ rawEft: naglfar, fitName: 'Public A', ownerUserId: 'user-a', visibility: 'public' });
  store.create({ rawEft: naglfar, fitName: 'Private B', ownerUserId: 'user-b', visibility: 'private' });

  const appA = Fastify();
  registerFitRoutes(appA, { store, currentUser: async () => userA });
  const privateList = await appA.inject({ method: 'GET', url: '/api/fits?visibility=private' });
  assert.deepEqual(JSON.parse(privateList.body).map((fit: { id: number }) => fit.id), [privateFit.id]);

  const publicList = await appA.inject({ method: 'GET', url: '/api/fits?visibility=public' });
  assert.deepEqual(JSON.parse(publicList.body).map((fit: { id: number }) => fit.id), [publicFit.id]);

  const appB = Fastify();
  registerFitRoutes(appB, { store, currentUser: async () => userB });
  const denied = await appB.inject({
    method: 'PUT',
    url: `/api/fits/${publicFit.id}`,
    payload: { fitName: 'Hijacked' },
  });
  assert.equal(denied.statusCode, 403);

  const copied = await appB.inject({ method: 'POST', url: `/api/fits/${publicFit.id}/copy-private` });
  assert.equal(copied.statusCode, 200);
  const copiedBody = JSON.parse(copied.body);
  assert.equal(copiedBody.ownerUserId, 'user-b');
  assert.equal(copiedBody.visibility, 'private');
  assert.equal(copiedBody.sourcePublicFitId, publicFit.id);
});

test('fit routes allow anonymous users to list and view public fits only', async () => {
  const store = testStore();
  const publicFit = store.create({ rawEft: naglfar, fitName: 'Public A', ownerUserId: 'user-a', visibility: 'public' });
  const privateFit = store.create({ rawEft: naglfar, fitName: 'Private A', ownerUserId: 'user-a', visibility: 'private' });
  const app = Fastify();
  registerFitRoutes(app, { store, currentUser: async () => null });

  const publicList = await app.inject({ method: 'GET', url: '/api/fits?visibility=public' });
  assert.equal(publicList.statusCode, 200);
  assert.deepEqual(JSON.parse(publicList.body).map((fit: { id: number }) => fit.id), [publicFit.id]);

  const publicDetail = await app.inject({ method: 'GET', url: `/api/fits/${publicFit.id}` });
  assert.equal(publicDetail.statusCode, 200);
  assert.equal(JSON.parse(publicDetail.body).fitName, 'Public A');

  const privateList = await app.inject({ method: 'GET', url: '/api/fits?visibility=private' });
  assert.equal(privateList.statusCode, 401);

  const privateDetail = await app.inject({ method: 'GET', url: `/api/fits/${privateFit.id}` });
  assert.equal(privateDetail.statusCode, 401);
});

test('fit routes publish owner fits and allow admins to edit public fits', async () => {
  const store = testStore();
  const saved = store.create({ rawEft: naglfar, fitName: 'Private A', ownerUserId: 'user-a', visibility: 'private' });

  const appA = Fastify();
  registerFitRoutes(appA, { store, currentUser: async () => userA });
  const published = await appA.inject({ method: 'POST', url: `/api/fits/${saved.id}/publish` });
  assert.equal(published.statusCode, 200);
  assert.equal(JSON.parse(published.body).visibility, 'public');

  const appAdmin = Fastify();
  registerFitRoutes(appAdmin, { store, currentUser: async () => ({ ...userB, role: 'admin' as const }) });
  const updated = await appAdmin.inject({
    method: 'PUT',
    url: `/api/fits/${saved.id}`,
    payload: { fitName: 'Admin Edited' },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(JSON.parse(updated.body).fitName, 'Admin Edited');
});

test('quote route delegates saved fit pricing with hub validation', async () => {
  const app = Fastify();
  const store = testStore();
  const saved = store.create({ rawEft: naglfar, ownerUserId: 'user-a' });
  registerFitRoutes(app, {
    store,
    currentUser: async () => userA,
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
  const saved = store.create({ rawEft: `${naglfar}\nDefinitely Not A Real Module`, ownerUserId: 'user-1' });
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
  const saved = store.create({ rawEft: naglfar, ownerUserId: 'user-1' });
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
