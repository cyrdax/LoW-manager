import assert from 'node:assert/strict';
import test from 'node:test';
import type { MasteryData } from '../skills/mastery-data.ts';
import {
  effectiveContractPrice,
  matchingShipQuantity,
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
