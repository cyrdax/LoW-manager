import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateCharactersDb } from '../characters/store.ts';
import type { CharacterRow } from '../types.ts';
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

function ownedCharacters(...characters: CharacterRow[]) {
  return {
    getOwned: async (userId: string, characterId: number) => (
      characters.find(character => character.user_id === userId && character.character_id === characterId)
    ),
  };
}

test('refreshPilotAssets stores a priced nested snapshot for one pilot', async () => {
  const snapshots = store();
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character,
    characterStore: ownedCharacters(character),
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
    characterStore: ownedCharacters({ ...character, scopes: 'esi-location.read_location.v1' }),
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
    characterStore: ownedCharacters({ ...character, needs_reauth: 1 }),
    store: snapshots,
    fetchAssets: async () => {
      called = true;
      return [];
    },
  });

  assert.equal(called, false);
  assert.equal(result.pilot.status, 'Needs re-auth');
});

test('refreshPilotAssets rejects a forged character row before calling ESI or writing a snapshot', async () => {
  const snapshots = store();
  let called = false;
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character: { ...character, character_id: 999, character_name: 'Forged Pilot' },
    characterStore: ownedCharacters(character),
    store: snapshots,
    fetchAssets: async () => {
      called = true;
      return [];
    },
  });

  assert.equal(called, false);
  assert.equal(result.pilot.status, 'Error');
  assert.equal(result.pilot.error, 'Character does not belong to this user.');
  assert.deepEqual(await snapshots.listSnapshots('user-a'), []);
});

test('refreshPilotAssets keeps blueprint copies unpriced when originals share their type ID', async () => {
  const snapshots = store();
  let quotedTypeIds: Array<number | null> = [];
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character,
    characterStore: ownedCharacters(character),
    store: snapshots,
    fetchAssets: async () => [
      { item_id: 1, type_id: 100, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: true, is_blueprint_copy: true },
      { item_id: 2, type_id: 100, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: true },
    ],
    resolveItem: typeId => ({ typeId, name: `Blueprint ${typeId}`, groupId: 2, groupName: 'Blueprint', categoryId: 9, categoryName: 'Blueprint' }),
    resolveLocation: async () => ({ locationId: 60003760, name: 'Jita', type: 'station', status: 'resolved' }),
    quoteItems: async (_hub, items) => {
      quotedTypeIds = items.map(item => item.typeId);
      return {
        hub: 'jita', systemName: 'Jita', regionName: 'The Forge', fetchedAt: 1, totalCost: 50,
        counts: { ok: 1, partial: 0, noOrders: 0, unknown: 0 },
        items: items.map(item => ({
          inputName: item.inputName, resolvedName: item.resolvedName, typeId: item.typeId,
          requestedQty: item.requestedQty, filledQty: item.requestedQty, totalCost: 50,
          avgPrice: 50, shortfall: 0, status: 'ok' as const, bucket: item.bucket,
        })),
      };
    },
  });

  const copy = result.locations[0].assets.find(asset => asset.itemId === 1)!;
  const original = result.locations[0].assets.find(asset => asset.itemId === 2)!;
  const storedCopy = (await snapshots.listSnapshots('user-a'))[0].locations[0].assets.find(asset => asset.itemId === 1)!;
  assert.deepEqual(quotedTypeIds, [100]);
  assert.equal(copy.pricingStatus, 'unpriced');
  assert.equal(copy.unitValue, null);
  assert.equal(copy.stackValue, 0);
  assert.equal(copy.blueprintCopy, true);
  assert.equal(storedCopy.blueprintCopy, true);
  assert.equal(original.pricingStatus, 'priced');
  assert.equal(original.unitValue, 50);
  assert.equal(result.pilot.unpricedStacks, 1);
});

test('refreshPilotAssets preserves a cached snapshot when asset scope is lost', async () => {
  const snapshots = store();
  const previous = await refreshPilotAssets({
    userId: 'user-a', character, characterStore: ownedCharacters(character), store: snapshots, now: () => 100,
    fetchAssets: async () => [{ item_id: 1, type_id: 34, quantity: 10, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: false }],
    resolveItem: typeId => ({ typeId, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' }),
    resolveLocation: async () => ({ locationId: 60003760, name: 'Jita', type: 'station', status: 'resolved' }),
    quoteItems: async (_hub, items) => ({
      hub: 'jita', systemName: 'Jita', regionName: 'The Forge', fetchedAt: 1, totalCost: 50,
      counts: { ok: 1, partial: 0, noOrders: 0, unknown: 0 },
      items: items.map(item => ({ inputName: item.inputName, resolvedName: item.resolvedName, typeId: item.typeId, requestedQty: item.requestedQty, filledQty: item.requestedQty, totalCost: 50, avgPrice: 5, shortfall: 0, status: 'ok' as const, bucket: item.bucket })),
    }),
  });
  const result = await refreshPilotAssets({
    userId: 'user-a', character: { ...character, scopes: '' }, characterStore: ownedCharacters({ ...character, scopes: '' }), store: snapshots, now: () => 200,
  });

  assert.equal(result.pilot.status, 'Missing asset scope');
  assert.equal(result.pilot.lastRefreshedAt, previous.pilot.lastRefreshedAt);
  assert.equal(result.locations.length, 1);
  assert.equal((await snapshots.listSnapshots('user-a'))[0].locations.length, 1);

  const reauth = await refreshPilotAssets({
    userId: 'user-a', character: { ...character, needs_reauth: 1 },
    characterStore: ownedCharacters({ ...character, needs_reauth: 1 }), store: snapshots, now: () => 300,
  });

  assert.equal(reauth.pilot.status, 'Needs re-auth');
  assert.equal(reauth.pilot.lastRefreshedAt, previous.pilot.lastRefreshedAt);
  assert.equal(reauth.locations.length, 1);
});

test('refreshPilotAssets preserves a cached snapshot when refresh fails', async () => {
  const snapshots = store();
  await refreshPilotAssets({
    userId: 'user-a', character, characterStore: ownedCharacters(character), store: snapshots, now: () => 100,
    fetchAssets: async () => [{ item_id: 1, type_id: 34, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: false }],
    resolveItem: typeId => ({ typeId, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' }),
    resolveLocation: async () => ({ locationId: 60003760, name: 'Jita', type: 'station', status: 'resolved' }),
    quoteItems: async () => ({ hub: 'jita', systemName: 'Jita', regionName: 'The Forge', fetchedAt: 1, totalCost: 0, counts: { ok: 0, partial: 0, noOrders: 1, unknown: 0 }, items: [] }),
  });
  const result = await refreshPilotAssets({
    userId: 'user-a', character, characterStore: ownedCharacters(character), store: snapshots, now: () => 200,
    fetchAssets: async () => { throw new Error('ESI unavailable'); },
  });

  assert.equal(result.pilot.status, 'Error');
  assert.equal(result.pilot.error, 'ESI unavailable');
  assert.equal(result.pilot.lastRefreshedAt, 100);
  assert.equal(result.locations.length, 1);
});

test('refreshPilotAssets coalesces concurrent refreshes for the same pilot', async () => {
  const snapshots = store();
  let fetchCalls = 0;
  let releaseFirstFetch: (() => void) | undefined;
  const firstFetchStarted = new Promise<void>(resolve => { releaseFirstFetch = resolve; });
  const first = refreshPilotAssets({
    userId: 'user-a', character, characterStore: ownedCharacters(character), store: snapshots,
    fetchAssets: async () => {
      fetchCalls++;
      await firstFetchStarted;
      return [{ item_id: 1, type_id: 34, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: false }];
    },
    resolveItem: typeId => ({ typeId, name: 'First result', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' }),
    resolveLocation: async () => ({ locationId: 60003760, name: 'Jita', type: 'station', status: 'resolved' }),
    quoteItems: async () => ({ hub: 'jita', systemName: 'Jita', regionName: 'The Forge', fetchedAt: 1, totalCost: 5, counts: { ok: 1, partial: 0, noOrders: 0, unknown: 0 }, items: [{ inputName: 'First result', resolvedName: 'First result', typeId: 34, requestedQty: 1, filledQty: 1, totalCost: 5, avgPrice: 5, shortfall: 0, status: 'ok' as const, bucket: 'minerals' }] }),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = refreshPilotAssets({
    userId: 'user-a', character, characterStore: ownedCharacters(character), store: snapshots,
    fetchAssets: async () => {
      fetchCalls++;
      return [{ item_id: 2, type_id: 35, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: false }];
    },
  });

  releaseFirstFetch!();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(fetchCalls, 1);
  assert.equal(firstResult.locations[0].assets[0].name, 'First result');
  assert.equal(secondResult.locations[0].assets[0].name, 'First result');
  assert.equal((await snapshots.listSnapshots('user-a'))[0].locations[0].assets[0].name, 'First result');
});

test('refreshPilotAssets falls back for a failed root location and never resolves item container ids', async () => {
  const snapshots = store();
  const resolvedLocationIds: number[] = [];
  const result = await refreshPilotAssets({
    userId: 'user-a', character, characterStore: ownedCharacters(character), store: snapshots,
    fetchAssets: async () => [
      { item_id: 1, type_id: 34, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: false },
      { item_id: 2, type_id: 34, quantity: 1, location_id: 30000142, location_type: 'solar_system', location_flag: 'Hangar', is_singleton: false },
      { item_id: 3, type_id: 34, quantity: 1, location_id: 1, location_type: 'item', location_flag: 'Cargo', is_singleton: false },
    ],
    resolveItem: typeId => ({ typeId, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' }),
    resolveLocation: async locationId => {
      resolvedLocationIds.push(locationId);
      if (locationId === 60003760) throw new Error('station unavailable');
      return { locationId, name: 'Jita', type: 'solar_system', status: 'resolved' };
    },
    quoteItems: async () => ({ hub: 'jita', systemName: 'Jita', regionName: 'The Forge', fetchedAt: 1, totalCost: 0, counts: { ok: 0, partial: 0, noOrders: 1, unknown: 0 }, items: [] }),
  });

  assert.deepEqual(resolvedLocationIds.sort((a, b) => a - b), [30000142, 60003760]);
  assert.equal(result.locations.find(location => location.locationId === 60003760)?.name, 'Unknown location 60003760');
  assert.equal(result.locations.find(location => location.locationId === 60003760)?.status, 'unresolved');
});

test('refreshAllAssets limits concurrency and returns per-pilot results', async () => {
  const snapshots = store();
  let active = 0;
  let maxActive = 0;
  const characters = [1, 2, 3].map(id => ({ ...character, character_id: id, character_name: `Pilot ${id}` }));

  const results = await refreshAllAssets({
    userId: 'user-a',
    characters,
    characterStore: ownedCharacters(...characters),
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

test('refreshAllAssets validates ownership before delegating to a custom refresher', async () => {
  const snapshots = store();
  let delegated = false;
  const [result] = await refreshAllAssets({
    userId: 'user-a', characters: [character], characterStore: ownedCharacters(), store: snapshots,
    refreshOne: async () => {
      delegated = true;
      throw new Error('should not run');
    },
  });

  assert.equal(delegated, false);
  assert.equal(result.pilot.status, 'Error');
  assert.deepEqual(await snapshots.listSnapshots('user-a'), []);
});

test('refreshAllAssets falls back to default concurrency for non-finite values', async () => {
  const snapshots = store();
  const characters = [1, 2, 3].map(id => ({ ...character, character_id: id }));
  let active = 0;
  let maxActive = 0;

  await refreshAllAssets({
    userId: 'user-a', characters, characterStore: ownedCharacters(...characters), store: snapshots,
    concurrency: Number.NaN,
    refreshOne: async input => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return {
        pilot: {
          characterId: input.character.character_id, characterName: input.character.character_name,
          status: 'Ready', error: null, lastRefreshedAt: null, locationCount: 0,
          itemCount: 0, stackCount: 0, pricedValue: 0, totalValue: 0, unpricedStacks: 0,
        },
        locations: [], categories: [],
      };
    },
  });

  assert.equal(maxActive, 3);
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
