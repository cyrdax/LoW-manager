import type { AssetLocationNode, AssetSnapshot, AssetTreeNode } from './api.ts';

export type AssetSortColumn = 'asset' | 'category' | 'quantity' | 'unitValue' | 'totalValue' | 'price';
export type AssetSortDirection = 'asc' | 'desc';

export interface AssetSortState {
  column: AssetSortColumn;
  direction: AssetSortDirection;
}

type SortValue = string | number | null;

export function sortAssetSnapshots(snapshots: AssetSnapshot[], sort: AssetSortState): AssetSnapshot[] {
  return [...snapshots]
    .map(snapshot => ({
      ...snapshot,
      locations: sortLocations(snapshot.locations, sort),
    }))
    .sort(compareRows(sort, snapshotValue, snapshotName));
}

function sortLocations(locations: AssetLocationNode[], sort: AssetSortState): AssetLocationNode[] {
  return [...locations]
    .map(location => ({
      ...location,
      assets: sortAssets(location.assets, sort),
    }))
    .sort(compareRows(sort, locationValue, locationName));
}

function sortAssets(assets: AssetTreeNode[], sort: AssetSortState): AssetTreeNode[] {
  return [...assets]
    .map(asset => ({
      ...asset,
      children: sortAssets(asset.children, sort),
    }))
    .sort(compareRows(sort, assetValue, assetName));
}

function compareRows<T>(
  sort: AssetSortState,
  valueFor: (row: T, column: AssetSortColumn) => SortValue,
  nameFor: (row: T) => string,
): (a: T, b: T) => number {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const primary = compareValues(valueFor(a, sort.column), valueFor(b, sort.column));
    if (primary !== 0) return primary * multiplier;
    return compareValues(nameFor(a), nameFor(b));
  };
}

function snapshotValue(snapshot: AssetSnapshot, column: AssetSortColumn): SortValue {
  switch (column) {
    case 'asset': return snapshot.pilot.characterName;
    case 'category': return snapshot.pilot.status;
    case 'quantity': return snapshot.pilot.itemCount;
    case 'unitValue': return averageValue(snapshot.pilot.totalValue, snapshot.pilot.itemCount);
    case 'totalValue': return snapshot.pilot.totalValue;
    case 'price': return snapshot.pilot.unpricedStacks;
  }
}

function locationValue(location: AssetLocationNode, column: AssetSortColumn): SortValue {
  switch (column) {
    case 'asset': return location.name;
    case 'category': return location.status === 'unresolved' ? `unresolved ${location.type}` : location.type;
    case 'quantity': return location.itemCount;
    case 'unitValue': return averageValue(location.totalValue, location.itemCount);
    case 'totalValue': return location.totalValue;
    case 'price': return location.unpricedStacks;
  }
}

function assetValue(asset: AssetTreeNode, column: AssetSortColumn): SortValue {
  switch (column) {
    case 'asset': return asset.name;
    case 'category': return asset.categoryLabel;
    case 'quantity': return asset.quantity;
    case 'unitValue': return asset.unitValue;
    case 'totalValue': return asset.stackValue;
    case 'price': return asset.pricingStatus;
  }
}

function snapshotName(snapshot: AssetSnapshot): string {
  return snapshot.pilot.characterName;
}

function locationName(location: AssetLocationNode): string {
  return location.name;
}

function assetName(asset: AssetTreeNode): string {
  return asset.name;
}

function averageValue(totalValue: number, itemCount: number): number | null {
  return itemCount > 0 ? totalValue / itemCount : null;
}

function compareValues(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
