import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSqliteAssetSnapshotStore, migrateAssetSnapshotsDb } from './store.ts';
import type { AssetSnapshot } from './types.ts';

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
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
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
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  const store = createSqliteAssetSnapshotStore(db);
  store.replaceSnapshot('user-a', sampleSnapshot(123));

  const stale = (await store.listSnapshots('user-a', 1_700_000_000_000 + 24 * 60 * 60 * 1000 + 1))[0];
  assert.equal(stale.pilot.status, 'Stale');
});

test('asset snapshot store records status without asset data', async () => {
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  const store = createSqliteAssetSnapshotStore(db);

  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Missing asset scope', 'Re-auth required', 1_700_000_000_000);
  const snapshots = await store.listSnapshots('user-a', 1_700_000_000_000);

  assert.equal(snapshots[0].pilot.status, 'Missing asset scope');
  assert.equal(snapshots[0].pilot.error, 'Re-auth required');
  assert.equal(snapshots[0].locations.length, 0);
});
