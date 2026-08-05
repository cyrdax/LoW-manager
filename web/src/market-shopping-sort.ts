import type { ShoppingItemQuote } from './api.ts';

export type ShoppingListSortDirection = 'asc' | 'desc';
export type ShoppingListSortKey =
  | 'item'
  | 'requestedQty'
  | 'filledQty'
  | 'avgPrice'
  | 'totalCost'
  | 'status';

const STATUS_RANK: Record<ShoppingItemQuote['status'], number> = {
  'no-orders': 0,
  ok: 1,
  partial: 2,
  'unknown-item': 3,
};

export function sortShoppingListResults<T extends ShoppingItemQuote>(
  rows: readonly T[],
  key: ShoppingListSortKey,
  direction: ShoppingListSortDirection,
): T[] {
  return [...rows].sort((a, b) => {
    const result = compareShoppingRows(a, b, key, direction);
    return direction === 'asc' ? result : -result;
  });
}

function compareShoppingRows(
  a: ShoppingItemQuote,
  b: ShoppingItemQuote,
  key: ShoppingListSortKey,
  direction: ShoppingListSortDirection,
): number {
  switch (key) {
    case 'item':
      return itemName(a).localeCompare(itemName(b));
    case 'requestedQty':
      return compareNumber(a.requestedQty, b.requestedQty);
    case 'filledQty':
      return compareNumber(a.filledQty, b.filledQty);
    case 'avgPrice':
      return compareNullableNumber(a.avgPrice, b.avgPrice, direction);
    case 'totalCost':
      return compareNumber(a.totalCost, b.totalCost);
    case 'status':
      return compareNumber(STATUS_RANK[a.status], STATUS_RANK[b.status]);
  }
}

function itemName(item: ShoppingItemQuote): string {
  return item.resolvedName ?? item.inputName;
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: ShoppingListSortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return direction === 'asc' ? 1 : -1;
  if (b == null) return direction === 'asc' ? -1 : 1;
  return a - b;
}
