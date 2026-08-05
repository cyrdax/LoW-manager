import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sortShoppingListResults,
  type ShoppingListSortKey,
} from '../../web/src/market-shopping-sort.ts';
import type { ShoppingItemQuote } from '../../web/src/api.ts';

const rows: ShoppingItemQuote[] = [
  row('Gamma Charge', 2, 2, 10, 20, 'ok'),
  row('Alpha Module', 8, 4, 4, 16, 'partial'),
  row('Beta Hull', 1, 0, null, 0, 'no-orders'),
];

test('sortShoppingListResults sorts every shopping result column ascending and descending', () => {
  const cases: Array<{
    key: ShoppingListSortKey;
    asc: string[];
    desc: string[];
  }> = [
    { key: 'item', asc: ['Alpha Module', 'Beta Hull', 'Gamma Charge'], desc: ['Gamma Charge', 'Beta Hull', 'Alpha Module'] },
    { key: 'requestedQty', asc: ['Beta Hull', 'Gamma Charge', 'Alpha Module'], desc: ['Alpha Module', 'Gamma Charge', 'Beta Hull'] },
    { key: 'filledQty', asc: ['Beta Hull', 'Gamma Charge', 'Alpha Module'], desc: ['Alpha Module', 'Gamma Charge', 'Beta Hull'] },
    { key: 'avgPrice', asc: ['Alpha Module', 'Gamma Charge', 'Beta Hull'], desc: ['Gamma Charge', 'Alpha Module', 'Beta Hull'] },
    { key: 'totalCost', asc: ['Beta Hull', 'Alpha Module', 'Gamma Charge'], desc: ['Gamma Charge', 'Alpha Module', 'Beta Hull'] },
    { key: 'status', asc: ['Beta Hull', 'Gamma Charge', 'Alpha Module'], desc: ['Alpha Module', 'Gamma Charge', 'Beta Hull'] },
  ];

  for (const tc of cases) {
    assert.deepEqual(sortShoppingListResults(rows, tc.key, 'asc').map(itemName), tc.asc, tc.key);
    assert.deepEqual(sortShoppingListResults(rows, tc.key, 'desc').map(itemName), tc.desc, tc.key);
  }

  assert.deepEqual(rows.map(itemName), ['Gamma Charge', 'Alpha Module', 'Beta Hull']);
});

function row(
  resolvedName: string,
  requestedQty: number,
  filledQty: number,
  avgPrice: number | null,
  totalCost: number,
  status: ShoppingItemQuote['status'],
): ShoppingItemQuote {
  return {
    inputName: resolvedName,
    resolvedName,
    typeId: null,
    requestedQty,
    filledQty,
    avgPrice,
    totalCost,
    status,
    shortfall: requestedQty - filledQty,
  };
}

function itemName(row: ShoppingItemQuote): string {
  return row.resolvedName ?? row.inputName;
}
