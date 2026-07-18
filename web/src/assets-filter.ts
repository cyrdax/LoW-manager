import type { AssetLocationNode, AssetSnapshot, AssetTreeNode, AssetValueSummary } from './api.ts';

const LEGACY_CATEGORY_ROLLUPS: Record<string, string[]> = {
  frigates: ['ships'],
  cruisers: ['ships'],
  battleships: ['ships'],
  capitals: ['ships'],
  'mining-ships': ['ships'],
  'armor-modules': ['modules'],
  'shield-modules': ['modules'],
  scanning: ['modules'],
  'cpu-powergrid': ['modules'],
  'weapon-upgrades': ['modules'],
  minerals: ['materials'],
  pi: ['materials'],
};

export function filterAssetSnapshots(pilots: AssetSnapshot[], query: string, category: string): AssetSnapshot[] {
  const normalizedQuery = query.trim().toLowerCase();
  return pilots
    .map(snapshot => filterSnapshot(snapshot, normalizedQuery, category))
    .filter((snapshot): snapshot is AssetSnapshot => snapshot != null);
}

function filterSnapshot(snapshot: AssetSnapshot, query: string, category: string): AssetSnapshot | null {
  const locations = snapshot.locations
    .map(location => filterLocation(location, query, category))
    .filter((location): location is AssetLocationNode => location != null);
  if (!matches(snapshot.pilot.characterName, query) && locations.length === 0 && !showsAll(query, category)) return null;

  return {
    ...snapshot,
    pilot: { ...snapshot.pilot, locationCount: locations.length, ...summarize(locations) },
    locations,
  };
}

function filterLocation(location: AssetLocationNode, query: string, category: string): AssetLocationNode | null {
  const assets = location.assets
    .map(asset => filterAsset(asset, query, category))
    .filter((asset): asset is AssetTreeNode => asset != null);
  if (!matches(location.name, query) && assets.length === 0 && !showsAll(query, category)) return null;

  return { ...location, assets, ...summarize(assets) };
}

function filterAsset(asset: AssetTreeNode, query: string, category: string): AssetTreeNode | null {
  const children = asset.children
    .map(child => filterAsset(child, query, category))
    .filter((child): child is AssetTreeNode => child != null);
  const rollups = asset.categoryRollups ?? LEGACY_CATEGORY_ROLLUPS[asset.category] ?? [];
  const categoryMatches = category === 'all' || asset.category === category || rollups.includes(category);
  const selfMatches = query === '' || matches(asset.name, query) || matches(asset.categoryLabel, query);
  if (!((categoryMatches && selfMatches) || children.length > 0)) return null;

  return {
    ...asset,
    children,
    ...summarize([ownSummary(asset), ...children]),
  };
}

function ownSummary(asset: AssetTreeNode): AssetValueSummary {
  return {
    itemCount: asset.quantity,
    stackCount: 1,
    pricedValue: asset.stackValue,
    totalValue: asset.stackValue,
    unpricedStacks: asset.pricingStatus === 'unpriced' ? 1 : 0,
  };
}

function summarize(rows: AssetValueSummary[]): AssetValueSummary {
  return rows.reduce<AssetValueSummary>((summary, row) => ({
    itemCount: summary.itemCount + row.itemCount,
    stackCount: summary.stackCount + row.stackCount,
    pricedValue: summary.pricedValue + row.pricedValue,
    totalValue: summary.totalValue + row.totalValue,
    unpricedStacks: summary.unpricedStacks + row.unpricedStacks,
  }), { itemCount: 0, stackCount: 0, pricedValue: 0, totalValue: 0, unpricedStacks: 0 });
}

function matches(value: string, query: string): boolean {
  return query !== '' && value.toLowerCase().includes(query);
}

function showsAll(query: string, category: string): boolean {
  return query === '' && category === 'all';
}
