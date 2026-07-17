import { ASSET_CATEGORY_LABELS, categorizeAssetItem } from './categories.ts';
import type {
  AssetCategoryKey,
  AssetCategorySummary,
  AssetLocationNode,
  AssetSnapshot,
  AssetTreeNode,
  AssetValueSummary,
  RawAssetInput,
  RawAssetLocationInput,
} from './types.ts';

export interface AssetSnapshotInput {
  characterId: number;
  characterName: string;
  status: AssetSnapshot['pilot']['status'];
  error: string | null;
  lastRefreshedAt: number | null;
  locations: RawAssetLocationInput[];
  assets: RawAssetInput[];
}

export function aggregateAssetSnapshot(input: AssetSnapshotInput): AssetSnapshot {
  const byItemId = new Map<number, AssetTreeNode>();
  const rootsByLocation = new Map<number, AssetTreeNode[]>();

  for (const raw of input.assets) {
    const category = categorizeAssetItem(raw);
    const stackValue = raw.unitValue == null ? 0 : raw.unitValue * raw.quantity;
    const node: AssetTreeNode = {
      itemId: raw.itemId,
      typeId: raw.typeId,
      name: raw.name,
      category: category.primary,
      categoryLabel: category.label,
      quantity: raw.quantity,
      unitValue: raw.unitValue,
      stackValue,
      pricingStatus: raw.pricingStatus,
      singleton: raw.singleton,
      parentItemId: raw.locationType === 'item' ? raw.locationId : null,
      locationId: raw.locationId,
      locationFlag: raw.locationFlag,
      locationType: raw.locationType,
      children: [],
      itemCount: raw.quantity,
      stackCount: 1,
      pricedValue: stackValue,
      totalValue: stackValue,
      unpricedStacks: raw.pricingStatus === 'unpriced' ? 1 : 0,
    };
    byItemId.set(node.itemId, node);
  }

  for (const node of byItemId.values()) {
    if (node.parentItemId != null) {
      const parent = byItemId.get(node.parentItemId);
      if (parent && !introducesParentCycle(node, parent, byItemId)) {
        parent.children.push(node);
        continue;
      }
      node.parentItemId = null;
    }
    const roots = rootsByLocation.get(node.locationId) ?? [];
    roots.push(node);
    rootsByLocation.set(node.locationId, roots);
  }

  const visited = new Set<number>();
  const visiting = new Set<number>();
  for (const roots of rootsByLocation.values()) {
    for (const root of roots) recalculateNode(root, visited, visiting);
  }
  for (const node of byItemId.values()) recalculateNode(node, visited, visiting);

  const locationInputs = new Map(input.locations.map(location => [location.locationId, location]));
  for (const locationId of rootsByLocation.keys()) {
    if (!locationInputs.has(locationId)) {
      locationInputs.set(locationId, {
        locationId,
        name: `Unknown location ${locationId}`,
        type: 'unknown',
        status: 'unresolved',
      });
    }
  }

  const locations: AssetLocationNode[] = [...locationInputs.values()]
    .map(location => {
      const assets = rootsByLocation.get(location.locationId) ?? [];
      const summary = summarize(assets);
      return {
        locationId: location.locationId,
        rawLocationId: location.locationId,
        name: location.name,
        type: location.type,
        status: location.status,
        assets,
        ...summary,
      };
    })
    .filter(location => location.assets.length > 0)
    .sort((a, b) => b.totalValue - a.totalValue || a.name.localeCompare(b.name));

  const categories = summarizeCategories(input.assets);
  const pilotSummary = summarize(locations);

  return {
    pilot: {
      characterId: input.characterId,
      characterName: input.characterName,
      status: input.status,
      locationCount: locations.length,
      lastRefreshedAt: input.lastRefreshedAt,
      error: input.error,
      ...pilotSummary,
    },
    locations,
    categories,
  };
}

export function buildAssetTree(input: AssetSnapshotInput): AssetSnapshot {
  return aggregateAssetSnapshot(input);
}

function introducesParentCycle(
  node: AssetTreeNode,
  parent: AssetTreeNode,
  byItemId: Map<number, AssetTreeNode>,
): boolean {
  const ancestors = new Set<number>();
  let current: AssetTreeNode | undefined = parent;

  while (current && !ancestors.has(current.itemId)) {
    if (current.itemId === node.itemId) return true;
    ancestors.add(current.itemId);
    current = current.parentItemId == null ? undefined : byItemId.get(current.parentItemId);
  }

  return false;
}

function recalculateNode(
  node: AssetTreeNode,
  visited: Set<number>,
  visiting: Set<number>,
): AssetValueSummary {
  if (visited.has(node.itemId)) return node;
  if (visiting.has(node.itemId)) return emptySummary();

  visiting.add(node.itemId);
  for (const child of node.children) recalculateNode(child, visited, visiting);
  visiting.delete(node.itemId);
  visited.add(node.itemId);

  const children = summarize(node.children);
  node.itemCount = node.quantity + children.itemCount;
  node.stackCount = 1 + children.stackCount;
  node.pricedValue = node.stackValue + children.pricedValue;
  node.totalValue = node.stackValue + children.totalValue;
  node.unpricedStacks = (node.pricingStatus === 'unpriced' ? 1 : 0) + children.unpricedStacks;
  node.children.sort((a, b) => b.totalValue - a.totalValue || a.name.localeCompare(b.name));
  return node;
}

function summarize(rows: AssetValueSummary[]): AssetValueSummary {
  return rows.reduce<AssetValueSummary>((acc, row) => ({
    itemCount: acc.itemCount + row.itemCount,
    stackCount: acc.stackCount + row.stackCount,
    pricedValue: acc.pricedValue + row.pricedValue,
    totalValue: acc.totalValue + row.totalValue,
    unpricedStacks: acc.unpricedStacks + row.unpricedStacks,
  }), emptySummary());
}

function emptySummary(): AssetValueSummary {
  return { itemCount: 0, stackCount: 0, pricedValue: 0, totalValue: 0, unpricedStacks: 0 };
}

function summarizeCategories(assets: RawAssetInput[]): AssetCategorySummary[] {
  const byCategory = new Map<AssetCategoryKey, AssetCategorySummary>();

  for (const raw of assets) {
    const category = categorizeAssetItem(raw);
    const value = raw.unitValue == null ? 0 : raw.unitValue * raw.quantity;
    const unpriced = raw.pricingStatus === 'unpriced' ? 1 : 0;
    for (const key of [category.primary, ...category.rollups]) {
      const row = byCategory.get(key) ?? {
        key,
        label: ASSET_CATEGORY_LABELS[key],
        itemCount: 0,
        stackCount: 0,
        pricedValue: 0,
        totalValue: 0,
        unpricedStacks: 0,
      };
      row.itemCount += raw.quantity;
      row.stackCount += 1;
      row.pricedValue += value;
      row.totalValue += value;
      row.unpricedStacks += unpriced;
      byCategory.set(key, row);
    }
  }

  return [...byCategory.values()].sort((a, b) => b.totalValue - a.totalValue || a.label.localeCompare(b.label));
}
