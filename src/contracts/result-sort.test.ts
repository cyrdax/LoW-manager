import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContractSearchResult } from './types.ts';
import { sortContractResultsByColumn, type ContractResultSortKey } from './result-sort.ts';

test('sortContractResultsByColumn sorts every visible contract table column', () => {
  const rows: ContractSearchResult[] = [
    row({
      contractId: 30,
      shipName: 'Rokh',
      type: 'auction',
      effectivePrice: 900,
      quantity: 2,
      locationName: 'Perimeter Trade Tower',
      systemName: 'Perimeter',
      regionName: 'The Forge',
      jumps: 1,
      dateExpired: '2026-07-10T00:00:00Z',
      title: 'B pack',
    }),
    row({
      contractId: 10,
      shipName: 'Barghest',
      type: 'item_exchange',
      effectivePrice: 1200,
      quantity: 1,
      locationName: 'Jita IV - Moon 4',
      systemName: 'Jita',
      regionName: 'The Forge',
      jumps: 0,
      dateExpired: '2026-07-09T00:00:00Z',
      title: 'A hull',
    }),
    row({
      contractId: 20,
      shipName: 'Barghest',
      type: 'auction',
      effectivePrice: null,
      quantity: 5,
      locationName: 'Unknown structure',
      systemName: null,
      regionName: 'Domain',
      jumps: null,
      dateExpired: '2026-07-11T00:00:00Z',
      title: 'C unknown',
    }),
  ];

  const expectedAsc: Record<ContractResultSortKey, number[]> = {
    ship: [10, 20, 30],
    type: [20, 30, 10],
    price: [30, 10, 20],
    quantity: [10, 30, 20],
    location: [10, 30, 20],
    jumps: [10, 30, 20],
    expires: [10, 30, 20],
    title: [10, 30, 20],
    contract: [10, 20, 30],
  };
  const expectedDesc: Record<ContractResultSortKey, number[]> = {
    ship: [30, 20, 10],
    type: [10, 30, 20],
    price: [10, 30, 20],
    quantity: [20, 30, 10],
    location: [20, 30, 10],
    jumps: [30, 10, 20],
    expires: [20, 30, 10],
    title: [20, 30, 10],
    contract: [30, 20, 10],
  };

  for (const [key, expected] of Object.entries(expectedAsc) as Array<[ContractResultSortKey, number[]]>) {
    assert.deepEqual(
      sortContractResultsByColumn(rows, key, 'asc').map(result => result.contractId),
      expected,
      key,
    );
    assert.deepEqual(
      sortContractResultsByColumn(rows, key, 'desc').map(result => result.contractId),
      expectedDesc[key],
      `${key} desc`,
    );
  }
});

function row(overrides: Partial<ContractSearchResult>): ContractSearchResult {
  return {
    contractId: 1,
    type: 'item_exchange',
    title: '',
    price: overrides.effectivePrice ?? null,
    buyout: null,
    effectivePrice: null,
    quantity: 1,
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionId: 10000002,
    regionName: 'The Forge',
    systemId: null,
    systemName: null,
    locationName: 'Unknown structure',
    locationKnown: false,
    jumps: null,
    dateIssued: '2026-07-08T00:00:00Z',
    dateExpired: '2026-07-09T00:00:00Z',
    ...overrides,
  };
}
