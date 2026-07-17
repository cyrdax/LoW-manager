export const ASSET_STALE_MS = 24 * 60 * 60 * 1000;

export type AssetCategoryKey =
  | 'ships'
  | 'frigates'
  | 'cruisers'
  | 'battleships'
  | 'capitals'
  | 'mining-ships'
  | 'modules'
  | 'armor-modules'
  | 'shield-modules'
  | 'scanning'
  | 'cpu-powergrid'
  | 'weapon-upgrades'
  | 'implants'
  | 'drones-fighters'
  | 'ammo'
  | 'materials'
  | 'minerals'
  | 'pi'
  | 'blueprints'
  | 'other';

export interface AssetCategoryInfo {
  key: AssetCategoryKey;
  label: string;
  primary: AssetCategoryKey;
  rollups: AssetCategoryKey[];
}

export interface AssetItemMetadata {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
}

export type AssetPricingStatus = 'priced' | 'partial' | 'unpriced';
export type AssetLocationStatus = 'resolved' | 'unresolved';
export type AssetPilotStatus = 'Ready' | 'Refreshing' | 'Needs refresh' | 'Stale' | 'Missing asset scope' | 'Needs re-auth' | 'Error';

export interface AssetValueSummary {
  itemCount: number;
  stackCount: number;
  pricedValue: number;
  totalValue: number;
  unpricedStacks: number;
}

export interface AssetTreeNode extends AssetValueSummary {
  itemId: number;
  typeId: number;
  name: string;
  category: AssetCategoryKey;
  categoryLabel: string;
  quantity: number;
  unitValue: number | null;
  stackValue: number;
  pricingStatus: AssetPricingStatus;
  singleton: boolean;
  parentItemId: number | null;
  locationId: number;
  locationFlag: string;
  locationType: string;
  children: AssetTreeNode[];
}

export interface AssetLocationNode extends AssetValueSummary {
  locationId: number;
  name: string;
  type: string;
  status: AssetLocationStatus;
  rawLocationId: number;
  assets: AssetTreeNode[];
}

export interface AssetCategorySummary extends AssetValueSummary {
  key: AssetCategoryKey;
  label: string;
}

export interface AssetPilotSummary extends AssetValueSummary {
  characterId: number;
  characterName: string;
  status: AssetPilotStatus;
  locationCount: number;
  lastRefreshedAt: number | null;
  error: string | null;
}

export interface AssetSnapshot {
  pilot: AssetPilotSummary;
  locations: AssetLocationNode[];
  categories: AssetCategorySummary[];
}

export interface RawAssetInput {
  itemId: number;
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  quantity: number;
  singleton: boolean;
  blueprintCopy?: boolean;
  locationId: number;
  locationFlag: string;
  locationType: string;
  unitValue: number | null;
  pricingStatus: AssetPricingStatus;
}

export interface RawAssetLocationInput {
  locationId: number;
  name: string;
  type: string;
  status: AssetLocationStatus;
}
