import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { PublicContractItem, PublicContractSummary } from './types.ts';
import {
  itemRefreshContractIds,
  migrateContractIndexDb,
  nextContractRegionToRefresh,
  prioritizeContractRegions,
  searchIndexedContracts,
  upsertContractIndexRegions,
} from './index-store.ts';
import { buildTopologyFromSystems, distancesFrom } from './map.ts';
import {
  refreshContractRegion,
  refreshDueContractRegion,
  type ContractRegionRefreshResult,
} from './indexer.ts';

const NOW = Date.parse('2026-07-08T12:00:00Z');
const EXPIRES = NOW + 300_000;

test('refreshContractRegion fetches all pages, indexes summaries, and refreshes active contract items', async () => {
  const db = memoryDb();
  const topology = topologyFixture();
  const pageCalls: Array<{ regionId: number; page: number }> = [];
  const itemCalls: number[] = [];

  const result = await refreshContractRegion({
    database: db,
    region: { id: 10000002, name: 'The Forge' },
    topology,
    now: () => NOW,
    fetchRegionContracts: async (regionId, page) => {
      pageCalls.push({ regionId, page });
      return {
        data: page === 1
          ? [
            contract(1, { start_location_id: 60003760 }),
            contract(2, { start_location_id: 1031231231231, type: 'auction' }),
          ]
          : [
            contract(3, { type: 'courier', start_location_id: 60003760 }),
            contract(4, { date_expired: '2026-07-07T00:00:00Z', start_location_id: 60003760 }),
          ],
        pages: 2,
        expiresAt: EXPIRES,
      };
    },
    fetchContractItems: async contractId => {
      itemCalls.push(contractId);
      return { data: [item(contractId * 10, 17920, 1, true)], expiresAt: EXPIRES };
    },
  });

  assert.deepEqual(pageCalls, [{ regionId: 10000002, page: 1 }, { regionId: 10000002, page: 2 }]);
  assert.deepEqual(itemCalls, [1, 2]);
  assert.deepEqual(result, {
    regionId: 10000002,
    pagesFetched: 2,
    contractsSeen: 4,
    itemFetches: 2,
    itemFailures: 0,
  } satisfies ContractRegionRefreshResult);

  const distances = distancesFrom(topology, 30000142, 30);
  const search = searchIndexedContracts(db, {
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionIds: [10000002],
    distances,
    now: NOW,
  });
  assert.deepEqual(search.results.map(row => row.contractId), [1, 2]);
  assert.equal(search.results[1].jumps, null);
});

test('refreshContractRegion marks contracts missing from the latest region page inactive', async () => {
  const db = memoryDb();
  const topology = topologyFixture();
  await refreshContractRegion({
    database: db,
    region: { id: 10000002, name: 'The Forge' },
    topology,
    now: () => NOW,
    fetchRegionContracts: async () => ({ data: [contract(1), contract(2)], pages: 1, expiresAt: EXPIRES }),
    fetchContractItems: async contractId => ({ data: [item(contractId, 17920, 1, true)], expiresAt: EXPIRES }),
  });

  await refreshContractRegion({
    database: db,
    region: { id: 10000002, name: 'The Forge' },
    topology,
    now: () => NOW + 60_000,
    fetchRegionContracts: async () => ({ data: [contract(2)], pages: 1, expiresAt: EXPIRES + 60_000 }),
    fetchContractItems: async () => ({ data: [], expiresAt: EXPIRES + 60_000 }),
  });

  const search = searchIndexedContracts(db, {
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionIds: [10000002],
    distances: distancesFrom(topology, 30000142, 30),
    now: NOW,
  });

  assert.deepEqual(search.results.map(row => row.contractId), [2]);
});

test('refreshContractRegion records item failures without failing the region refresh', async () => {
  const db = memoryDb();
  const topology = topologyFixture();

  const result = await refreshContractRegion({
    database: db,
    region: { id: 10000002, name: 'The Forge' },
    topology,
    now: () => NOW,
    fetchRegionContracts: async () => ({ data: [contract(1), contract(2)], pages: 1, expiresAt: EXPIRES }),
    fetchContractItems: async contractId => {
      if (contractId === 2) throw new Error('ESI sad');
      return { data: [item(contractId, 17920, 1, true)], expiresAt: EXPIRES };
    },
  });

  assert.equal(result.itemFetches, 1);
  assert.equal(result.itemFailures, 1);
  assert.deepEqual(itemRefreshContractIds(db, 10000002, NOW + 1), [2]);
});

test('refreshDueContractRegion refreshes prioritized due work and returns null when nothing is due', async () => {
  const db = memoryDb();
  const topology = topologyFixture();
  upsertContractIndexRegions(db, [
    { id: 10000002, name: 'The Forge' },
    { id: 10000043, name: 'Domain' },
  ], NOW);
  db.prepare(`
    UPDATE contract_index_regions
    SET refreshed_at = ?, expires_at = ?, next_refresh_at = ?, priority = 0
  `).run(NOW, NOW + 60_000, NOW + 60_000);
  prioritizeContractRegions(db, [10000043], NOW);

  const refreshed = await refreshDueContractRegion({
    database: db,
    topology,
    now: () => NOW,
    fetchRegionContracts: async () => ({ data: [], pages: 1, expiresAt: EXPIRES }),
    fetchContractItems: async () => ({ data: [], expiresAt: EXPIRES }),
  });
  assert.equal(refreshed?.regionId, 10000043);
  assert.equal(nextContractRegionToRefresh(db, NOW), null);

  const none = await refreshDueContractRegion({
    database: db,
    topology,
    now: () => NOW,
    fetchRegionContracts: async () => ({ data: [], pages: 1, expiresAt: EXPIRES }),
    fetchContractItems: async () => ({ data: [], expiresAt: EXPIRES }),
  });
  assert.equal(none, null);
});

function memoryDb() {
  const db = new Database(':memory:');
  migrateContractIndexDb(db);
  return db;
}

function topologyFixture() {
  return buildTopologyFromSystems([
    { systemId: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge', neighbors: [] },
  ], [
    { stationId: 60003760, stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', solarSystemId: 30000142 },
  ]);
}

function contract(contract_id: number, overrides: Partial<PublicContractSummary> = {}): PublicContractSummary {
  return {
    contract_id,
    issuer_id: 9,
    issuer_corporation_id: 10,
    type: 'item_exchange',
    date_issued: '2026-07-08T00:00:00Z',
    date_expired: '2026-07-09T00:00:00Z',
    title: `Contract ${contract_id}`,
    price: 1_000,
    start_location_id: 60003760,
    ...overrides,
  };
}

function item(
  record_id: number,
  type_id: number,
  quantity: number,
  is_included: boolean,
): PublicContractItem {
  return { record_id, type_id, quantity, is_included };
}

