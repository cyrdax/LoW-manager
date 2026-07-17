import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateCharactersDb } from '../characters/store.ts';
import { refreshAllAssets, refreshPilotAssets, summarizeAssets } from './refresh.ts';
import { createSqliteAssetSnapshotStore, migrateAssetSnapshotsDb } from './store.ts';

function store() {
  const db = new Database(':memory:');
  migrateCharactersDb(db);
  migrateAssetSnapshotsDb(db);
  db.prepare(`
    INSERT INTO characters (character_id, user_id, character_name, owner_hash, scopes, refresh_token, added_at)
    VALUES (123, 'user-a', 'Asset Pilot', 'owner', 'esi-assets.read_assets.v1', 'refresh', 1)
  `).run();
  return createSqliteAssetSnapshotStore(db);
}

const character = {
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

test('refreshPilotAssets stores a priced nested snapshot for one pilot', async () => {
  const snapshots = store();
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character,
    store: snapshots,
    now: () => 1_700_000_000_000,
    fetchAssets: async () => [
      { item_id: 1, type_id: 587, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: true },
      { item_id: 2, type_id: 34, quantity: 100, location_id: 1, location_type: 'item', location_flag: 'Cargo', is_singleton: false },
    ],
    resolveItem: typeId => typeId === 587
      ? { typeId, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship' }
      : { typeId, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' },
    resolveLocation: async () => ({ locationId: 60003760, name: 'Jita IV - Moon 4', type: 'station', status: 'resolved' }),
    quoteItems: async (_hub, items) => ({
      hub: 'jita',
      systemName: 'Jita',
      regionName: 'The Forge',
      fetchedAt: 1,
      totalCost: 1_000_500,
      counts: { ok: 2, partial: 0, noOrders: 0, unknown: 0 },
      items: items.map(item => ({
        inputName: item.inputName,
        resolvedName: item.resolvedName,
        typeId: item.typeId,
        requestedQty: item.requestedQty,
        filledQty: item.requestedQty,
        totalCost: item.typeId === 587 ? 1_000_000 : 500,
        avgPrice: item.typeId === 587 ? 1_000_000 : 5,
        shortfall: 0,
        status: 'ok' as const,
        bucket: item.bucket,
      })),
    }),
  });

  assert.equal(result.pilot.status, 'Ready');
  assert.equal(result.pilot.totalValue, 1_000_500);
  assert.equal(result.locations[0].assets[0].children[0].name, 'Tritanium');
});

test('refreshPilotAssets records missing asset scope without calling ESI', async () => {
  const snapshots = store();
  let called = false;
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character: { ...character, scopes: 'esi-location.read_location.v1' },
    store: snapshots,
    now: () => 1_700_000_000_000,
    fetchAssets: async () => {
      called = true;
      return [];
    },
  });

  assert.equal(called, false);
  assert.equal(result.pilot.status, 'Missing asset scope');
});

test('refreshPilotAssets records needs re-auth without calling ESI', async () => {
  const snapshots = store();
  let called = false;
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character: { ...character, needs_reauth: 1 },
    store: snapshots,
    fetchAssets: async () => {
      called = true;
      return [];
    },
  });

  assert.equal(called, false);
  assert.equal(result.pilot.status, 'Needs re-auth');
});

test('refreshAllAssets limits concurrency and returns per-pilot results', async () => {
  const snapshots = store();
  let active = 0;
  let maxActive = 0;
  const characters = [1, 2, 3].map(id => ({ ...character, character_id: id, character_name: `Pilot ${id}` }));

  const results = await refreshAllAssets({
    userId: 'user-a',
    characters,
    store: snapshots,
    concurrency: 2,
    now: () => 1_700_000_000_000,
    refreshOne: async input => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return {
        pilot: {
          characterId: input.character.character_id,
          characterName: input.character.character_name,
          status: 'Ready', error: null, lastRefreshedAt: 1, locationCount: 0,
          itemCount: 0, stackCount: 0, pricedValue: 0, totalValue: 0, unpricedStacks: 0,
        },
        locations: [], categories: [],
      };
    },
  });

  assert.equal(results.length, 3);
  assert.equal(maxActive, 2);
});

test('summarizeAssets builds dashboard totals across snapshots', () => {
  const summary = summarizeAssets([{
    pilot: {
      characterId: 1, characterName: 'One', status: 'Ready', error: null, lastRefreshedAt: 10,
      locationCount: 1, itemCount: 2, stackCount: 1, pricedValue: 100, totalValue: 100, unpricedStacks: 0,
    },
    locations: [],
    categories: [{ key: 'ships', label: 'Ships', itemCount: 1, stackCount: 1, pricedValue: 100, totalValue: 100, unpricedStacks: 0 }],
  }]);

  assert.equal(summary.totalValue, 100);
  assert.equal(summary.lastRefreshedAt, 10);
  assert.equal(summary.categories[0].key, 'ships');
});
