import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { MasteryData } from '../skills/mastery-data.ts';
import {
  effectiveContractPrice,
  matchingShipQuantity,
  runContractSearch,
  searchContractShips,
  sortContractResults,
  validateContractRadius,
  type ContractSearchResult,
} from './search.ts';
import {
  migrateContractIndexDb,
  nextContractRegionToRefresh,
  replaceContractItems,
  upsertContractIndexRegions,
  upsertRegionContracts,
} from './index-store.ts';
import { buildTopologyFromSystems } from './map.ts';
import type { PublicContractItem, PublicContractSummary } from './types.ts';

const NOW = Date.parse('2026-07-08T00:00:00Z');
const EXPIRES = NOW + 300_000;

const masteryData = {
  ships: {
    '17920': { name: 'Barghest', groupId: 27, groupName: 'Battleship', requiredSkills: [], masteries: [[], [], [], [], []] },
    '24688': { name: 'Rokh', groupId: 27, groupName: 'Battleship', requiredSkills: [], masteries: [[], [], [], [], []] },
    '587': { name: 'Rifter', groupId: 25, groupName: 'Frigate', requiredSkills: [], masteries: [[], [], [], [], []] },
  },
} as unknown as MasteryData;

test('searchContractShips returns prefix matches before substring matches', () => {
  const hits = searchContractShips(masteryData, 'bar', 10);
  assert.deepEqual(hits, [{ id: 17920, name: 'Barghest', groupName: 'Battleship' }]);
});

test('searchContractShips requires at least two characters', () => {
  assert.deepEqual(searchContractShips(masteryData, 'b'), []);
});

test('validateContractRadius defaults invalid input and rejects out-of-range values', () => {
  assert.equal(validateContractRadius(Number.NaN), 30);
  assert.equal(validateContractRadius(1), 1);
  assert.equal(validateContractRadius(100), 100);
  assert.throws(() => validateContractRadius(0), /radius must be between 1 and 100/);
  assert.throws(() => validateContractRadius(101), /radius must be between 1 and 100/);
});

test('matchingShipQuantity sums only included positive-quantity ship rows', () => {
  const qty = matchingShipQuantity([
    { record_id: 1, type_id: 17920, quantity: 1, is_included: true },
    { record_id: 2, type_id: 17920, quantity: 2, is_included: true },
    { record_id: 3, type_id: 17920, quantity: 1, is_included: false },
    { record_id: 4, type_id: 24688, quantity: 7, is_included: true },
    { record_id: 5, type_id: 17920, quantity: 0, is_included: true },
  ], 17920);
  assert.equal(qty, 3);
});

test('effectiveContractPrice prefers price, then buyout, then null', () => {
  assert.equal(effectiveContractPrice({ contract_id: 1, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-01-01T00:00:00Z', date_expired: '2026-01-02T00:00:00Z', price: 10 }), 10);
  assert.equal(effectiveContractPrice({ contract_id: 2, type: 'auction', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-01-01T00:00:00Z', date_expired: '2026-01-02T00:00:00Z', buyout: 20 }), 20);
  assert.equal(effectiveContractPrice({ contract_id: 3, type: 'auction', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-01-01T00:00:00Z', date_expired: '2026-01-02T00:00:00Z' }), null);
});

test('sortContractResults sorts known jumps before unknown, then price', () => {
  const rows: ContractSearchResult[] = [
    row(1, null, 1_000),
    row(2, 5, 900),
    row(3, 2, 3_000),
    row(4, 2, 1_000),
    row(5, null, 100),
  ];
  assert.deepEqual(sortContractResults(rows).map(r => r.contractId), [4, 3, 2, 5, 1]);
});

test('runContractSearch reads indexed contracts and returns coverage metadata', async () => {
  const db = memoryDb();
  const topology = topologyFixture();
  seedIndexedRegion(db, topology);

  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    database: db,
    now: () => NOW,
    topology,
  });

  assert.equal(response.ship.name, 'Barghest');
  assert.equal(response.origin.name, 'Jita');
  assert.deepEqual(response.regionsScanned, [{ id: 10000002, name: 'The Forge' }]);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].contractId, 1);
  assert.equal(response.results[0].quantity, 1);
  assert.equal(response.results[0].jumps, 0);
  assert.equal(response.results[0].locationName, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant');
  assert.equal(response.index.regionsTotal, 1);
  assert.equal(response.index.regionsReady, 1);
  assert.equal(response.index.complete, true);
  assert.deepEqual(response.warnings, []);
});

test('runContractSearch warns when matching contracts have unresolved locations', async () => {
  const db = memoryDb();
  const topology = topologyFixture();
  upsertContractIndexRegions(db, [{ id: 10000002, name: 'The Forge' }], NOW);
  upsertRegionContracts(db, {
    region: { id: 10000002, name: 'The Forge' },
    topology,
    refreshedAt: NOW - 60_000,
    expiresAt: EXPIRES,
    contracts: [
      contract(1, { start_location_id: 60003760 }),
      contract(2, { start_location_id: 1031231231231 }),
    ],
  });
  replaceContractItems(db, 1, [item(11, 17920, 1, true)], NOW - 60_000, EXPIRES);
  replaceContractItems(db, 2, [item(21, 17920, 1, true)], NOW - 60_000, EXPIRES);
  db.prepare(`
    UPDATE contract_index_regions
    SET next_refresh_at = ?
    WHERE region_id = ?
  `).run(EXPIRES, 10000002);

  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    database: db,
    now: () => NOW,
    topology,
  });

  assert.deepEqual(response.results.map(row => row.contractId), [1]);
  assert.deepEqual(response.warnings, [{
    code: 'contract_locations_unresolved',
    message: 'Skipped contracts in unresolved player structures because jumps cannot be calculated',
    count: 1,
  }]);
});

test('runContractSearch prioritizes touched regions for background refresh', async () => {
  const db = memoryDb();
  const topology = topologyFixture();
  seedIndexedRegion(db, topology);
  assert.equal(nextContractRegionToRefresh(db, NOW), null);

  await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    database: db,
    now: () => NOW,
    topology,
  });

  assert.deepEqual(nextContractRegionToRefresh(db, NOW), { id: 10000002, name: 'The Forge' });
});

test('runContractSearch returns warming metadata and warning when index coverage is incomplete', async () => {
  const db = memoryDb();
  const topology = topologyFixture();

  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    database: db,
    now: () => NOW,
    topology,
  });

  assert.deepEqual(response.results, []);
  assert.equal(response.index.regionsTotal, 1);
  assert.equal(response.index.regionsReady, 0);
  assert.equal(response.index.regionsMissing, 1);
  assert.equal(response.warnings.length, 1);
  assert.equal(response.warnings[0].code, 'contract_index_warming');
});

function row(contractId: number, jumps: number | null, effectivePrice: number | null): ContractSearchResult {
  return {
    contractId,
    type: 'item_exchange',
    title: '',
    price: effectivePrice,
    buyout: null,
    effectivePrice,
    quantity: 1,
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionId: 10000002,
    regionName: 'The Forge',
    systemId: jumps == null ? null : 30000142 + jumps,
    systemName: jumps == null ? null : `System ${jumps}`,
    locationName: jumps == null ? 'Unknown structure' : `System ${jumps}`,
    locationKnown: jumps != null,
    jumps,
    dateIssued: '2026-01-01T00:00:00Z',
    dateExpired: '2026-01-02T00:00:00Z',
  };
}

function memoryDb() {
  const db = new Database(':memory:');
  migrateContractIndexDb(db);
  return db;
}

function topologyFixture() {
  return buildTopologyFromSystems([
    { systemId: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge', neighbors: [30000145] },
    { systemId: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge', neighbors: [30000142] },
  ], [
    { stationId: 60003760, stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', solarSystemId: 30000142 },
  ]);
}

function seedIndexedRegion(db: Database.Database, topology: ReturnType<typeof topologyFixture>) {
  upsertContractIndexRegions(db, [{ id: 10000002, name: 'The Forge' }], NOW);
  upsertRegionContracts(db, {
    region: { id: 10000002, name: 'The Forge' },
    topology,
    refreshedAt: NOW - 60_000,
    expiresAt: EXPIRES,
    contracts: [
      contract(1, { start_location_id: 60003760, price: 50, title: 'Barghest hull' }),
      contract(2, { type: 'courier', start_location_id: 60003760 }),
      contract(3, { date_expired: '2026-07-02T00:00:00Z', start_location_id: 60003760 }),
    ],
  });
  replaceContractItems(db, 1, [item(11, 17920, 1, true)], NOW - 60_000, EXPIRES);
  replaceContractItems(db, 2, [item(21, 17920, 1, true)], NOW - 60_000, EXPIRES);
  replaceContractItems(db, 3, [item(31, 17920, 1, true)], NOW - 60_000, EXPIRES);

  db.prepare(`
    UPDATE contract_index_regions
    SET next_refresh_at = ?
    WHERE region_id = ?
  `).run(EXPIRES, 10000002);
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
