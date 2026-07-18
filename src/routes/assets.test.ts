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

const missingScopePilot = { ...pilot, character_id: 124, character_name: 'Missing Scope', scopes: '' };
const needsReauthPilot = { ...pilot, character_id: 125, character_name: 'Needs Re-auth', needs_reauth: 1 as const };

test('assets routes reject unauthenticated requests without executing dependencies', async () => {
  for (const request of [
    { method: 'GET' as const, url: '/api/assets' },
    { method: 'POST' as const, url: '/api/assets/refresh' },
    { method: 'POST' as const, url: '/api/assets/characters/123/refresh' },
  ]) {
    const app = Fastify();
    let dependencyCalls = 0;
    const unexpected = async () => {
      dependencyCalls++;
      throw new Error('unauthenticated request must not execute dependencies');
    };
    registerAssetsRoutes(app, {
      currentUser: async () => null,
      store: {
        listSnapshots: unexpected,
        replaceSnapshot: unexpected,
        recordPilotStatus: unexpected,
        deleteForUser: unexpected,
      },
      characters: { listByUser: unexpected, listUsableByUser: unexpected, getOwned: unexpected },
      refreshPilot: unexpected,
      refreshAll: unexpected,
    });

    const res = await app.inject(request);
    assert.equal(res.statusCode, 401, `${request.method} ${request.url}`);
    assert.equal(dependencyCalls, 0, `${request.method} ${request.url}`);
  }
});

test('GET /api/assets merges authenticated pilots with cached snapshots and read-only placeholders', async () => {
  const store = testStore();
  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Needs refresh', null, 1);
  store.recordPilotStatus('user-b', 456, 'Other Pilot', 'Needs refresh', null, 1);
  const listByUserCalls: string[] = [];
  const app = Fastify();
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store,
    characters: {
      listByUser: async userId => {
        listByUserCalls.push(userId);
        return [pilot, missingScopePilot, needsReauthPilot];
      },
      listUsableByUser: async () => [],
      getOwned: async () => undefined,
    },
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
  assert.deepEqual(listByUserCalls, ['user-a']);
  assert.deepEqual(body.pilots.map((snapshot: ReturnType<typeof snapshotFor>) => [
    snapshot.pilot.characterId,
    snapshot.pilot.status,
  ]), [
    [123, 'Needs refresh'],
    [124, 'Missing asset scope'],
    [125, 'Needs re-auth'],
  ]);
  assert.equal(body.dashboard.pilots.length, 3);
});

test('POST /api/assets/characters/:id/refresh scopes refresh to owned pilot', async () => {
  const app = Fastify();
  let refreshed = 0;
  const getOwnedCalls: Array<[string, number]> = [];
  const characters = {
    listByUser: async () => [pilot],
    listUsableByUser: async () => [pilot],
    getOwned: async (userId: string, id: number) => {
      getOwnedCalls.push([userId, id]);
      return id === 123 ? pilot : undefined;
    },
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
  assert.deepEqual(getOwnedCalls, [['user-a', 123]]);

  const missing = await app.inject({ method: 'POST', url: '/api/assets/characters/456/refresh' });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(getOwnedCalls, [['user-a', 123], ['user-a', 456]]);
});

test('POST /api/assets/characters/:id/refresh rejects non-canonical IDs before ownership lookup', async () => {
  for (const characterId of ['0', '-1', '1.5', '00123', '123abc', '9007199254740992']) {
    const app = Fastify();
    let getOwnedCalls = 0;
    registerAssetsRoutes(app, {
      currentUser: async () => userA,
      store: testStore(),
      characters: {
        listByUser: async () => [],
        listUsableByUser: async () => [],
        getOwned: async () => {
          getOwnedCalls++;
          return undefined;
        },
      },
    });

    const res = await app.inject({ method: 'POST', url: `/api/assets/characters/${characterId}/refresh` });
    assert.equal(res.statusCode, 400, characterId);
    assert.deepEqual(JSON.parse(res.body), { error: 'invalid_character_id' }, characterId);
    assert.equal(getOwnedCalls, 0, characterId);
  }
});

test('POST /api/assets/refresh returns a full cached and placeholder roster', async () => {
  const store = testStore();
  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Ready', null, 1);
  const listUsableByUserCalls: string[] = [];
  const listByUserCalls: string[] = [];
  const app = Fastify();
  const characters = {
    listByUser: async (userId: string) => {
      listByUserCalls.push(userId);
      return [pilot, missingScopePilot, needsReauthPilot];
    },
    listUsableByUser: async (userId: string) => {
      listUsableByUserCalls.push(userId);
      return [pilot, missingScopePilot];
    },
    getOwned: async () => pilot,
  };
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store,
    characters,
    refreshAll: async input => {
      assert.equal(input.characterStore, characters);
      return input.characters.map(character => snapshotFor(character.character_id, character.character_name));
    },
  });

  const res = await app.inject({ method: 'POST', url: '/api/assets/refresh' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(listUsableByUserCalls, ['user-a']);
  assert.deepEqual(listByUserCalls, ['user-a']);
  assert.deepEqual(body.pilots.map((snapshot: ReturnType<typeof snapshotFor>) => snapshot.pilot.characterId), [123, 124, 125]);
  assert.deepEqual(body.dashboard.pilots.map((summary: { characterId: number }) => summary.characterId), [123, 124, 125]);
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
