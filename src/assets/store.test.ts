import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateCharactersDb } from '../characters/store.ts';
import {
  createPostgresAssetSnapshotStore,
  createSqliteAssetSnapshotStore,
  migrateAssetSnapshotsDb,
} from './store.ts';
import type { AssetSnapshot } from './types.ts';

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateCharactersDb(db);
  migrateAssetSnapshotsDb(db);
  return db;
}

function addCharacter(db: Database.Database, userId: string, characterId: number, characterName = 'Asset Pilot') {
  db.prepare(`
    INSERT INTO characters (
      character_id, user_id, character_name, owner_hash, scopes, refresh_token, added_at
    ) VALUES (?, ?, ?, 'owner', 'scope', 'refresh', 0)
  `).run(characterId, userId, characterName);
}

function sampleSnapshot(characterId = 123): AssetSnapshot {
  return {
    pilot: {
      characterId,
      characterName: 'Asset Pilot',
      status: 'Ready',
      locationCount: 1,
      lastRefreshedAt: 1_700_000_000_000,
      error: null,
      itemCount: 10,
      stackCount: 2,
      pricedValue: 1_000_500,
      totalValue: 1_000_500,
      unpricedStacks: 0,
    },
    locations: [{
      locationId: 60003760,
      rawLocationId: 60003760,
      name: 'Jita IV - Moon 4',
      type: 'station',
      status: 'resolved',
      itemCount: 10,
      stackCount: 2,
      pricedValue: 1_000_500,
      totalValue: 1_000_500,
      unpricedStacks: 0,
      assets: [],
    }],
    categories: [{
      key: 'ships',
      label: 'Ships',
      itemCount: 1,
      stackCount: 1,
      pricedValue: 1_000_000,
      totalValue: 1_000_000,
      unpricedStacks: 0,
    }],
  };
}

test('asset snapshot store replaces and lists user-scoped snapshots', async () => {
  const db = memoryDb();
  addCharacter(db, 'user-a', 123);
  addCharacter(db, 'user-b', 456);
  const store = createSqliteAssetSnapshotStore(db);

  store.replaceSnapshot('user-a', sampleSnapshot(123));
  store.replaceSnapshot('user-b', sampleSnapshot(456));
  store.replaceSnapshot('user-a', {
    ...sampleSnapshot(123),
    pilot: { ...sampleSnapshot(123).pilot, totalValue: 2_000_000 },
  });

  const userA = await store.listSnapshots('user-a', 1_700_000_000_100);
  assert.equal(userA.length, 1);
  assert.equal(userA[0].pilot.characterId, 123);
  assert.equal(userA[0].pilot.totalValue, 2_000_000);

  const userB = await store.listSnapshots('user-b', 1_700_000_000_100);
  assert.equal(userB.length, 1);
  assert.equal(userB[0].pilot.characterId, 456);
});

test('asset snapshot store marks stale snapshots older than 24 hours', async () => {
  const db = memoryDb();
  addCharacter(db, 'user-a', 123);
  const store = createSqliteAssetSnapshotStore(db);
  store.replaceSnapshot('user-a', sampleSnapshot(123));

  const stale = (await store.listSnapshots('user-a', 1_700_000_000_000 + 24 * 60 * 60 * 1000 + 1))[0];
  assert.equal(stale.pilot.status, 'Stale');
});

test('asset snapshot store records status without asset data', async () => {
  const db = memoryDb();
  addCharacter(db, 'user-a', 123);
  const store = createSqliteAssetSnapshotStore(db);

  store.replaceSnapshot('user-a', sampleSnapshot(123));
  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Missing asset scope', 'Re-auth required', 1_700_000_000_000);
  const snapshots = await store.listSnapshots('user-a', 1_700_000_000_000);

  assert.equal(snapshots[0].pilot.status, 'Missing asset scope');
  assert.equal(snapshots[0].pilot.error, 'Re-auth required');
  assert.equal(snapshots[0].locations.length, 0);
  const row = db.prepare('SELECT last_refreshed_at FROM asset_snapshots WHERE user_id = ? AND character_id = ?')
    .get('user-a', 123) as { last_refreshed_at: number | null };
  assert.equal(
    row.last_refreshed_at,
    null,
  );
});

test('asset snapshot store rejects snapshots for characters owned by another user', () => {
  const db = memoryDb();
  addCharacter(db, 'user-a', 123);
  const store = createSqliteAssetSnapshotStore(db);

  assert.throws(() => store.replaceSnapshot('user-b', sampleSnapshot(123)), /FOREIGN KEY constraint failed/);
  assert.throws(
    () => store.recordPilotStatus('user-b', 123, 'Asset Pilot', 'Missing asset scope', null, 1_700_000_000_000),
    /FOREIGN KEY constraint failed/,
  );
});

test('asset snapshot store deletes only the requested user snapshots', async () => {
  const db = memoryDb();
  addCharacter(db, 'user-a', 123);
  addCharacter(db, 'user-b', 456);
  const store = createSqliteAssetSnapshotStore(db);
  store.replaceSnapshot('user-a', sampleSnapshot(123));
  store.replaceSnapshot('user-b', sampleSnapshot(456));

  store.deleteForUser('user-a');

  assert.deepEqual(await store.listSnapshots('user-a'), []);
  assert.equal((await store.listSnapshots('user-b')).length, 1);
});

test('Postgres asset snapshot store parses JSONB objects and strings', async () => {
  const objectSnapshot = sampleSnapshot(123);
  const textSnapshot = sampleSnapshot(456);
  let listCalls = 0;
  const client = {
    async query() {
      listCalls += 1;
      return { rows: [{ snapshot_json: listCalls === 1 ? objectSnapshot : JSON.stringify(textSnapshot) }] };
    },
  };
  const store = createPostgresAssetSnapshotStore(client as never);

  const objectRows = await store.listSnapshots('user-a', 1_700_000_000_100);
  const textRows = await store.listSnapshots('user-a', 1_700_000_000_100);

  assert.equal(objectRows[0].pilot.characterId, 123);
  assert.equal(textRows[0].pilot.characterId, 456);
});

test('Postgres status upserts clear the previous refresh timestamp', async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      return { rows: [] };
    },
  };
  const store = createPostgresAssetSnapshotStore(client as never);

  await store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Missing asset scope', null, 1_700_000_000_000);

  assert.match(queries[0], /ON CONFLICT[\s\S]*last_refreshed_at = NULL/);
});
