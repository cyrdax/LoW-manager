import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { PublicContractItem, PublicContractSummary } from './types.ts';
import {
  getContractIndexCoverage,
  migrateContractIndexDb,
  nextContractRegionToRefresh,
  prioritizeContractRegions,
  replaceContractItems,
  searchIndexedContracts,
  upsertContractIndexRegions,
  upsertRegionContracts,
} from './index-store.ts';
import { buildTopologyFromSystems, distancesFrom } from './map.ts';

const NOW = Date.parse('2026-07-08T12:00:00Z');
const EXPIRES = NOW + 5 * 60_000;

test('contract index migration creates region contract and item tables', () => {
  const db = memoryDb();

  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'contract_index_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;

  assert.deepEqual(tables.map(row => row.name), [
    'contract_index_items',
    'contract_index_regions',
    'contract_index_summaries',
  ]);
});

test('indexed search returns matching included ship items and excludes out-of-radius known locations', () => {
  const db = seededDb();
  const topology = buildTopologyFromSystems([
    { systemId: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge', neighbors: [30000145] },
    { systemId: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge', neighbors: [30000142, 30000148] },
    { systemId: 30000148, name: 'Urlen', regionId: 10000002, regionName: 'The Forge', neighbors: [30000145] },
  ], [
    { stationId: 60003760, stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', solarSystemId: 30000142 },
    { stationId: 60000001, stationName: 'Urlen Station', solarSystemId: 30000148 },
  ]);
  const distances = distancesFrom(topology, 30000142, 1);

  upsertRegionContracts(db, {
    region: { id: 10000002, name: 'The Forge' },
    contracts: [
      contract(1, { start_location_id: 60003760, price: 100 }),
      contract(2, { start_location_id: 60000001, price: 50 }),
      contract(3, { start_location_id: 60003760, type: 'courier' }),
      contract(4, { start_location_id: 60003760, date_expired: '2026-07-07T00:00:00Z' }),
    ],
    topology,
    refreshedAt: NOW,
    expiresAt: EXPIRES,
  });
  replaceContractItems(db, 1, [
    item(11, 17920, 1, true),
    item(12, 17920, 4, false),
    item(13, 24688, 9, true),
    item(14, 17920, 0, true),
  ], NOW, EXPIRES);
  replaceContractItems(db, 2, [item(21, 17920, 1, true)], NOW, EXPIRES);
  replaceContractItems(db, 3, [item(31, 17920, 1, true)], NOW, EXPIRES);
  replaceContractItems(db, 4, [item(41, 17920, 1, true)], NOW, EXPIRES);

  const search = searchIndexedContracts(db, {
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionIds: [10000002],
    distances,
    now: NOW,
  });

  assert.deepEqual(search.results.map(row => row.contractId), [1]);
  assert.equal(search.results[0].quantity, 1);
  assert.equal(search.results[0].locationName, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant');
  assert.equal(search.results[0].jumps, 0);
});

test('indexed search excludes unknown-location contracts and reports skipped count', () => {
  const db = seededDb();
  const topology = buildTopologyFromSystems([
    { systemId: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge', neighbors: [] },
  ], [
    { stationId: 60003760, stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', solarSystemId: 30000142 },
  ]);
  const distances = distancesFrom(topology, 30000142, 30);

  upsertRegionContracts(db, {
    region: { id: 10000002, name: 'The Forge' },
    contracts: [
      contract(1, { start_location_id: 60003760, price: 200 }),
      contract(2, { start_location_id: 1031231231231, price: 100 }),
    ],
    topology,
    refreshedAt: NOW,
    expiresAt: EXPIRES,
  });
  replaceContractItems(db, 1, [item(11, 17920, 1, true)], NOW, EXPIRES);
  replaceContractItems(db, 2, [item(21, 17920, 2, true)], NOW, EXPIRES);

  const search = searchIndexedContracts(db, {
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionIds: [10000002],
    distances,
    now: NOW,
  });

  assert.deepEqual(search.results.map(row => row.contractId), [1]);
  assert.equal(search.unresolvedLocationCount, 1);
});

test('coverage reports ready stale and missing regions', () => {
  const db = memoryDb();
  upsertContractIndexRegions(db, [
    { id: 10000002, name: 'The Forge' },
    { id: 10000043, name: 'Domain' },
  ], NOW);
  db.prepare(`
    UPDATE contract_index_regions
    SET refreshed_at = ?, expires_at = ?, next_refresh_at = ?
    WHERE region_id = ?
  `).run(NOW - 60_000, NOW + 60_000, NOW + 60_000, 10000002);
  db.prepare(`
    UPDATE contract_index_regions
    SET refreshed_at = ?, expires_at = ?, next_refresh_at = ?
    WHERE region_id = ?
  `).run(NOW - 600_000, NOW - 60_000, NOW - 60_000, 10000043);

  const coverage = getContractIndexCoverage(db, [10000002, 10000043, 10000001], NOW);

  assert.equal(coverage.regionsTotal, 3);
  assert.equal(coverage.regionsReady, 1);
  assert.equal(coverage.regionsStale, 1);
  assert.equal(coverage.regionsMissing, 1);
  assert.equal(coverage.oldestRefreshedAt, NOW - 600_000);
  assert.equal(coverage.newestRefreshedAt, NOW - 60_000);
});

test('prioritizing regions makes the next due region refreshable first', () => {
  const db = memoryDb();
  upsertContractIndexRegions(db, [
    { id: 10000002, name: 'The Forge' },
    { id: 10000043, name: 'Domain' },
  ], NOW);
  db.prepare(`
    UPDATE contract_index_regions
    SET refreshed_at = ?, expires_at = ?, next_refresh_at = ?, priority = 0
  `).run(NOW, NOW + 60_000, NOW + 60_000);

  assert.equal(nextContractRegionToRefresh(db, NOW), null);

  prioritizeContractRegions(db, [10000043], NOW);
  const work = nextContractRegionToRefresh(db, NOW);

  assert.deepEqual(work, { id: 10000043, name: 'Domain' });
});

function memoryDb() {
  const db = new Database(':memory:');
  migrateContractIndexDb(db);
  return db;
}

function seededDb() {
  const db = memoryDb();
  upsertContractIndexRegions(db, [{ id: 10000002, name: 'The Forge' }], NOW);
  return db;
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
