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

export interface AssetFilterOptions {
  includeShipCargoSearch?: boolean;
}

export function filterAssetSnapshots(
  pilots: AssetSnapshot[],
  query: string,
  category: string,
  options: AssetFilterOptions = {},
): AssetSnapshot[] {
  const normalizedQuery = query.trim().toLowerCase();
  return pilots
    .map(snapshot => filterSnapshot(snapshot, normalizedQuery, category, options))
    .filter((snapshot): snapshot is AssetSnapshot => snapshot != null);
}

function filterSnapshot(snapshot: AssetSnapshot, query: string, category: string, options: AssetFilterOptions): AssetSnapshot | null {
  const pilotMatches = matches(snapshot.pilot.characterName, query);
  const locations = snapshot.locations
    .map(location => filterLocation(location, query, category, pilotMatches, options))
    .filter((location): location is AssetLocationNode => location != null);
  if (locations.length === 0 && (query !== '' || category !== 'all')) return null;

  return {
    ...snapshot,
    pilot: { ...snapshot.pilot, locationCount: locations.length, ...summarize(locations) },
    locations,
  };
}

function filterLocation(
  location: AssetLocationNode,
  query: string,
  category: string,
  ancestorMatches: boolean,
  options: AssetFilterOptions,
): AssetLocationNode | null {
  const locationMatches = ancestorMatches || matches(location.name, query) || matches(location.systemName ?? '', query);
  const assets = location.assets
    .map(asset => filterAsset(asset, query, category, locationMatches, options, false))
    .filter((asset): asset is AssetTreeNode => asset != null);
  if (assets.length === 0) return null;

  return { ...location, assets, ...summarize(assets) };
}

function filterAsset(
  asset: AssetTreeNode,
  query: string,
  category: string,
  ancestorMatches: boolean,
  options: AssetFilterOptions,
  insideShipCargo: boolean,
): AssetTreeNode | null {
  const searchable = query === '' || options.includeShipCargoSearch === true || !insideShipCargo;
  const selfMatches = query === '' || (searchable && (matches(asset.name, query) || matches(asset.categoryLabel, query)));
  const queryMatches = ancestorMatches || selfMatches;
  const childInsideShipCargo = insideShipCargo || isShipAsset(asset);
  const children = asset.children
    .map(child => filterAsset(child, query, category, queryMatches, options, childInsideShipCargo))
    .filter((child): child is AssetTreeNode => child != null);
  const rollups = asset.categoryRollups ?? LEGACY_CATEGORY_ROLLUPS[asset.category] ?? [];
  const categoryMatches = category === 'all' || asset.category === category || rollups.includes(category);
  const includeOwnSummary = categoryMatches && queryMatches;
  if (!includeOwnSummary && children.length === 0) return null;

  return {
    ...asset,
    children,
    ...summarize(includeOwnSummary ? [ownSummary(asset), ...children] : children),
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

function isShipAsset(asset: AssetTreeNode): boolean {
  const rollups = asset.categoryRollups ?? LEGACY_CATEGORY_ROLLUPS[asset.category] ?? [];
  return asset.category === 'ships' || rollups.includes('ships');
}
