export type ContractResultSortKey =
  | 'ship'
  | 'type'
  | 'price'
  | 'quantity'
  | 'location'
  | 'jumps'
  | 'expires'
  | 'title'
  | 'contract';

export type SortDirection = 'asc' | 'desc';

export interface SortableContractResult {
  contractId: number;
  type: string;
  title: string;
  effectivePrice: number | null;
  quantity: number;
  shipName: string;
  regionName: string;
  systemName: string | null;
  locationName: string;
  jumps: number | null;
  dateExpired: string;
}

export function sortContractResultsByColumn<T extends SortableContractResult>(
  rows: T[],
  key: ContractResultSortKey,
  direction: SortDirection,
): T[] {
  return [...rows].sort((a, b) => {
    return compareByKey(a, b, key, direction);
  });
}

export function sortContractResultsDefault<T extends SortableContractResult>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const jumps = compareNullableNumber(a.jumps, b.jumps);
    if (jumps !== 0) return jumps;

    const price = compareNullableNumber(a.effectivePrice, b.effectivePrice);
    if (price !== 0) return price;

    return compareDate(a.dateExpired, b.dateExpired) || a.contractId - b.contractId;
  });
}

function compareByKey(
  a: SortableContractResult,
  b: SortableContractResult,
  key: ContractResultSortKey,
  direction: SortDirection,
): number {
  const factor = direction === 'asc' ? 1 : -1;
  switch (key) {
    case 'ship':
      return factor * (compareText(a.shipName, b.shipName) || compareNumber(a.contractId, b.contractId));
    case 'type':
      return factor * (compareText(typeLabel(a.type), typeLabel(b.type)) || compareNumber(a.contractId, b.contractId));
    case 'price':
      return compareNullableNumber(a.effectivePrice, b.effectivePrice, direction) || factor * compareNumber(a.contractId, b.contractId);
    case 'quantity':
      return factor * (compareNumber(a.quantity, b.quantity) || compareNumber(a.contractId, b.contractId));
    case 'location':
      return factor * (compareText(locationLabel(a), locationLabel(b)) || compareNumber(a.contractId, b.contractId));
    case 'jumps':
      return compareNullableNumber(a.jumps, b.jumps, direction) || factor * compareNumber(a.contractId, b.contractId);
    case 'expires':
      return factor * (compareDate(a.dateExpired, b.dateExpired) || compareNumber(a.contractId, b.contractId));
    case 'title':
      return factor * (compareText(a.title, b.title) || compareNumber(a.contractId, b.contractId));
    case 'contract':
      return factor * compareNumber(a.contractId, b.contractId);
  }
}

function compareNullableNumber(a: number | null, b: number | null, direction: SortDirection = 'asc'): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const cmp = compareNumber(a, b);
  return direction === 'asc' ? cmp : -cmp;
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareDate(a: string, b: string): number {
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (Number.isFinite(at) && Number.isFinite(bt)) return compareNumber(at, bt);
  return compareText(a, b);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function typeLabel(type: string): string {
  return type === 'item_exchange' ? 'Item exchange' : type;
}

function locationLabel(row: SortableContractResult): string {
  return `${row.locationName} ${row.systemName ?? ''} ${row.regionName}`;
}
