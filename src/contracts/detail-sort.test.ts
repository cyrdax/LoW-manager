import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sortContractDetailItems,
  type ContractDetailSortKey,
} from '../../web/src/contract-detail-sort.ts';
import type { ContractDetailItem, ShoppingItemQuote } from '../../web/src/api.ts';

const items: ContractDetailItem[] = [
  item(1, 100, 'Gamma Launcher', 'Launcher', 'Module', 2),
  item(2, 200, 'Alpha Hull', 'Battleship', 'Ship', 1),
  item(3, 300, 'Beta Script', 'Script', 'Charge', 8),
];

const quotes = new Map<number, ShoppingItemQuote>([
  [100, quote(100, 'Gamma Launcher', 10, 20, 'ok')],
  [200, quote(200, 'Alpha Hull', null, 0, 'no-orders')],
  [300, quote(300, 'Beta Script', 4, 32, 'partial')],
]);

test('sortContractDetailItems sorts all contract detail modal columns', () => {
  const cases: Array<{ key: ContractDetailSortKey; asc: string[]; desc: string[] }> = [
    { key: 'item', asc: ['Alpha Hull', 'Beta Script', 'Gamma Launcher'], desc: ['Gamma Launcher', 'Beta Script', 'Alpha Hull'] },
    { key: 'category', asc: ['Beta Script', 'Gamma Launcher', 'Alpha Hull'], desc: ['Alpha Hull', 'Gamma Launcher', 'Beta Script'] },
    { key: 'quantity', asc: ['Alpha Hull', 'Gamma Launcher', 'Beta Script'], desc: ['Beta Script', 'Gamma Launcher', 'Alpha Hull'] },
    { key: 'unit', asc: ['Beta Script', 'Gamma Launcher', 'Alpha Hull'], desc: ['Gamma Launcher', 'Beta Script', 'Alpha Hull'] },
    { key: 'total', asc: ['Alpha Hull', 'Gamma Launcher', 'Beta Script'], desc: ['Beta Script', 'Gamma Launcher', 'Alpha Hull'] },
    { key: 'status', asc: ['Alpha Hull', 'Gamma Launcher', 'Beta Script'], desc: ['Beta Script', 'Gamma Launcher', 'Alpha Hull'] },
  ];

  for (const tc of cases) {
    assert.deepEqual(sortContractDetailItems(items, quotes, tc.key, 'asc').map(i => i.name), tc.asc, tc.key);
    assert.deepEqual(sortContractDetailItems(items, quotes, tc.key, 'desc').map(i => i.name), tc.desc, tc.key);
  }

  assert.deepEqual(items.map(i => i.name), ['Gamma Launcher', 'Alpha Hull', 'Beta Script']);
});

function item(
  recordId: number,
  typeId: number,
  name: string,
  groupName: string,
  categoryName: string,
  quantity: number,
): ContractDetailItem {
  return { recordId, typeId, name, groupName, categoryName, quantity };
}

function quote(
  typeId: number,
  name: string,
  avgPrice: number | null,
  totalCost: number,
  status: ShoppingItemQuote['status'],
): ShoppingItemQuote {
  return {
    inputName: name,
    resolvedName: name,
    typeId,
    requestedQty: 1,
    filledQty: status === 'no-orders' ? 0 : 1,
    avgPrice,
    totalCost,
    shortfall: status === 'partial' ? 1 : 0,
    status,
  };
}
