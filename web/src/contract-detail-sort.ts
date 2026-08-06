import type { ContractDetailItem, ShoppingItemQuote } from './api.ts';

export type ContractDetailSortDirection = 'asc' | 'desc';
export type ContractDetailSortKey = 'item' | 'category' | 'quantity' | 'unit' | 'total' | 'status';

const STATUS_RANK: Record<ShoppingItemQuote['status'], number> = {
  'no-orders': 0,
  ok: 1,
  partial: 2,
  'unknown-item': 3,
};

export function sortContractDetailItems<T extends ContractDetailItem>(
  items: readonly T[],
  quotesByType: ReadonlyMap<number, ShoppingItemQuote>,
  key: ContractDetailSortKey,
  direction: ContractDetailSortDirection,
): T[] {
  return [...items].sort((a, b) => {
    const result = compareContractDetailItems(a, b, quotesByType, key, direction);
    return direction === 'asc' ? result : -result;
  });
}

function compareContractDetailItems(
  a: ContractDetailItem,
  b: ContractDetailItem,
  quotesByType: ReadonlyMap<number, ShoppingItemQuote>,
  key: ContractDetailSortKey,
  direction: ContractDetailSortDirection,
): number {
  const aq = quotesByType.get(a.typeId) ?? null;
  const bq = quotesByType.get(b.typeId) ?? null;
  switch (key) {
    case 'item':
      return a.name.localeCompare(b.name);
    case 'category':
      return categoryLabel(a).localeCompare(categoryLabel(b));
    case 'quantity':
      return a.quantity - b.quantity;
    case 'unit':
      return compareNullableNumber(aq?.avgPrice ?? null, bq?.avgPrice ?? null, direction);
    case 'total':
      return compareNumber(aq?.totalCost ?? 0, bq?.totalCost ?? 0);
    case 'status':
      return compareNumber(statusRank(aq), statusRank(bq));
  }
}

function categoryLabel(item: ContractDetailItem): string {
  return `${item.categoryName} ${item.groupName}`;
}

function statusRank(quote: ShoppingItemQuote | null): number {
  return quote ? STATUS_RANK[quote.status] : STATUS_RANK['unknown-item'];
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: ContractDetailSortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return direction === 'asc' ? 1 : -1;
  if (b == null) return direction === 'asc' ? -1 : 1;
  return a - b;
}
