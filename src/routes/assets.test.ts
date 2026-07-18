import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createSqliteAssetSnapshotStore, migrateAssetSnapshotsDb } from '../assets/store.ts';
import { migrateCharactersDb } from '../characters/store.ts';
import { registerAssetsRoutes } from './assets.ts';

function testStore() {
  const db = new Database(':memory:');
  migrateCharactersDb(db);
  migrateAssetSnapshotsDb(db);
  const insertCharacter = db.prepare(`
    INSERT INTO characters (
      character_id, user_id, character_name, owner_hash, scopes, refresh_token,
      access_token, access_token_expires_at, added_at, needs_reauth, is_boss
    ) VALUES (?, ?, ?, 'owner', '', 'refresh', NULL, NULL, 1, 0, 0)
  `);
  insertCharacter.run(123, 'user-a', 'Asset Pilot');
  insertCharacter.run(456, 'user-b', 'Other Pilot');
  return createSqliteAssetSnapshotStore(db);
}

const userA = { id: 'user-a', email: null, role: 'user' as const, status: 'active' as const };
const pilot = {
  character_id: 123,
  user_id: 'user-a',
  character_name: 'Asset Pilot',
  owner_hash: 'owner',
  scopes: 'esi-assets.read_assets.v1',
  refresh_token: 'refresh',
  access_token: null,
  access_token_expires_at: null,
  added_at: 1,
  needs_reauth: 0 as const,
  is_boss: 0 as const,
};

test('assets routes require an authenticated user', async () => {
  const app = Fastify();
  registerAssetsRoutes(app, {
    currentUser: async () => null,
    store: testStore(),
    characters: { listByUser: async () => [], listUsableByUser: async () => [], getOwned: async () => undefined },
  });

  const res = await app.inject({ method: 'GET', url: '/api/assets' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/assets returns cached user-scoped snapshots and dashboard', async () => {
  const store = testStore();
  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Needs refresh', null, 1);
  store.recordPilotStatus('user-b', 456, 'Other Pilot', 'Needs refresh', null, 1);
  const app = Fastify();
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store,
    characters: { listByUser: async () => [pilot], listUsableByUser: async () => [pilot], getOwned: async () => pilot },
    now: () => 1,
    refreshPilot: async () => {
      throw new Error('GET must not refresh assets');
    },
    refreshAll: async () => {
      throw new Error('GET must not refresh assets');
    },
  });

  const res = await app.inject({ method: 'GET', url: '/api/assets' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.pilots.length, 1);
  assert.equal(body.pilots[0].pilot.characterId, 123);
});

test('POST /api/assets/characters/:id/refresh scopes refresh to owned pilot', async () => {
  const app = Fastify();
  let refreshed = 0;
  const characters = {
    listByUser: async () => [pilot],
    listUsableByUser: async () => [pilot],
    getOwned: async (_userId: string, id: number) => id === 123 ? pilot : undefined,
  };
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store: testStore(),
    characters,
    refreshPilot: async input => {
      refreshed++;
      assert.equal(input.characterStore, characters);
      return snapshotFor(input.character.character_id, input.character.character_name);
    },
  });

  const ok = await app.inject({ method: 'POST', url: '/api/assets/characters/123/refresh' });
  assert.equal(ok.statusCode, 200);
  assert.equal(refreshed, 1);

  const missing = await app.inject({ method: 'POST', url: '/api/assets/characters/456/refresh' });
  assert.equal(missing.statusCode, 404);
});

test('POST /api/assets/refresh refreshes all usable owned pilots', async () => {
  const app = Fastify();
  const characters = {
    listByUser: async () => [pilot],
    listUsableByUser: async () => [pilot],
    getOwned: async () => pilot,
  };
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store: testStore(),
    characters,
    refreshAll: async input => {
      assert.equal(input.characterStore, characters);
      return input.characters.map(character => snapshotFor(character.character_id, character.character_name));
    },
  });

  const res = await app.inject({ method: 'POST', url: '/api/assets/refresh' });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).pilots.length, 1);
});

function snapshotFor(characterId: number, characterName: string) {
  return {
    pilot: {
      characterId,
      characterName,
      status: 'Ready' as const,
      error: null,
      lastRefreshedAt: 1,
      locationCount: 0,
      itemCount: 0,
      stackCount: 0,
      pricedValue: 0,
      totalValue: 0,
      unpricedStacks: 0,
    },
    locations: [],
    categories: [],
  };
}
