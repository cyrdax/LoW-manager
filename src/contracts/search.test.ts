import assert from 'node:assert/strict';
import test from 'node:test';
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

test('runContractSearch returns active matching contracts with distances', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => id === 30000142 ? 'Jita' : `System ${id}`,
    topology: {
      systems: new Map([
        [30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }],
        [30000145, { id: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge' }],
      ]),
      adjacency: new Map([[30000142, [30000145]], [30000145, [30000142]]]),
      stations: new Map([[60003760, { stationId: 60003760, stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', solarSystemId: 30000142 }]]),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 1, type: 'item_exchange', issuer_id: 9, issuer_corporation_id: 10, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 50, start_location_id: 60003760, title: 'Barghest hull' },
        { contract_id: 2, type: 'courier', issuer_id: 9, issuer_corporation_id: 10, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', start_location_id: 60003760 },
        { contract_id: 3, type: 'item_exchange', issuer_id: 9, issuer_corporation_id: 10, date_issued: '2026-07-01T00:00:00Z', date_expired: '2026-07-02T00:00:00Z', price: 5, start_location_id: 60003760 },
      ],
      pages: 1,
    }),
    fetchContractItems: async contractId => contractId === 1
      ? [{ record_id: 11, type_id: 17920, quantity: 1, is_included: true }]
      : [],
  });

  assert.equal(response.ship.name, 'Barghest');
  assert.equal(response.origin.name, 'Jita');
  assert.deepEqual(response.regionsScanned, [{ id: 10000002, name: 'The Forge' }]);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].contractId, 1);
  assert.equal(response.results[0].quantity, 1);
  assert.equal(response.results[0].jumps, 0);
  assert.equal(response.results[0].locationName, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant');
});

test('runContractSearch keeps unknown-location matches after known-distance matches', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => `System ${id}`,
    topology: {
      systems: new Map([[30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }]]),
      adjacency: new Map([[30000142, []]]),
      stations: new Map(),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 10, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 10, start_location_id: 99000001 },
        { contract_id: 11, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 30000142 },
      ],
      pages: 1,
    }),
    fetchContractItems: async () => [{ record_id: 1, type_id: 17920, quantity: 1, is_included: true }],
  });

  assert.deepEqual(response.results.map(r => r.contractId), [11, 10]);
  assert.equal(response.results[1].locationKnown, false);
  assert.equal(response.results[1].jumps, null);
});

test('runContractSearch excludes known-location matches outside the selected radius', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 1,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => `System ${id}`,
    topology: {
      systems: new Map([
        [30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }],
        [30000145, { id: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge' }],
        [30000146, { id: 30000146, name: 'Urlen', regionId: 10000002, regionName: 'The Forge' }],
      ]),
      adjacency: new Map([
        [30000142, [30000145]],
        [30000145, [30000142, 30000146]],
        [30000146, [30000145]],
      ]),
      stations: new Map(),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 30, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 10, start_location_id: 30000146 },
        { contract_id: 31, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 99000001 },
      ],
      pages: 1,
    }),
    fetchContractItems: async () => [{ record_id: 1, type_id: 17920, quantity: 1, is_included: true }],
  });

  assert.deepEqual(response.results.map(r => r.contractId), [31]);
  assert.equal(response.results[0].locationKnown, false);
  assert.equal(response.results[0].jumps, null);
});

test('runContractSearch fetches additional contract pages through a shared concurrency-3 pool', async () => {
  let activePageFetches = 0;
  let maxActivePageFetches = 0;

  await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => `System ${id}`,
    topology: {
      systems: new Map([[30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }]]),
      adjacency: new Map([[30000142, []]]),
      stations: new Map(),
    },
    fetchRegionContracts: async (_regionId, page) => {
      if (page === 1) {
        return {
          data: [],
          pages: 5,
        };
      }

      activePageFetches += 1;
      maxActivePageFetches = Math.max(maxActivePageFetches, activePageFetches);
      await Promise.resolve();
      activePageFetches -= 1;

      return {
        data: [],
        pages: 5,
      };
    },
    fetchContractItems: async () => [],
  });

  assert.equal(maxActivePageFetches, 3);
});

test('runContractSearch returns partial warning when an item fetch fails', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => `System ${id}`,
    topology: {
      systems: new Map([[30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }]]),
      adjacency: new Map([[30000142, []]]),
      stations: new Map(),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 21, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 30000142 },
        { contract_id: 22, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 30000142 },
      ],
      pages: 1,
    }),
    fetchContractItems: async contractId => {
      if (contractId === 22) throw new Error('ESI failed');
      return [{ record_id: 1, type_id: 17920, quantity: 1, is_included: true }];
    },
  });

  assert.equal(response.results.length, 1);
  assert.equal(response.warnings.length, 1);
  assert.equal(response.warnings[0].code, 'contract_items_failed');
  assert.equal(response.warnings[0].count, 1);
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
