import type { CharacterRow } from '../types.ts';
import type { AsyncCharacterStore } from '../characters/store.ts';
import { getCharacterAssets, type EsiCharacterAsset } from '../esi/assets.ts';
import { resolveStation, resolveStructure, resolveSystem } from '../esi/universe.ts';
import { resolveItemByTypeId } from '../fits/metadata.ts';
import { quoteResolvedMarketItems } from '../market/pricing.ts';
import { buildAssetTree } from './tree.ts';
import type { AssetSnapshotStore } from './store.ts';
import type {
  AssetCategorySummary,
  AssetItemMetadata,
  AssetSnapshot,
  AssetValueSummary,
  RawAssetInput,
  RawAssetLocationInput,
} from './types.ts';

export interface RefreshPilotAssetsInput {
  userId: string;
  character: CharacterRow;
  characterStore: Pick<AsyncCharacterStore, 'getOwned'>;
  store: AssetSnapshotStore;
  now?: () => number;
  structureCharacterIds?: number[];
  fetchAssets?: (characterId: number) => Promise<EsiCharacterAsset[]>;
  resolveItem?: (typeId: number) => AssetItemMetadata | null;
  resolveLocation?: (locationId: number, locationType: string, characterId: number) => Promise<RawAssetLocationInput>;
  quoteItems?: typeof quoteResolvedMarketItems;
}

export interface RefreshAllAssetsInput extends Omit<RefreshPilotAssetsInput, 'character'> {
  characters: CharacterRow[];
  concurrency?: number;
  refreshOne?: (input: RefreshPilotAssetsInput) => Promise<AssetSnapshot>;
}

export interface AssetDashboardResponse extends AssetValueSummary {
  pilots: AssetSnapshot['pilot'][];
  categories: AssetCategorySummary[];
  lastRefreshedAt: number | null;
}

const inFlightPilotRefreshes = new Map<string, Promise<AssetSnapshot>>();

export function refreshPilotAssets(input: RefreshPilotAssetsInput): Promise<AssetSnapshot> {
  const key = `${input.userId}:${input.character.character_id}`;
  const inFlight = inFlightPilotRefreshes.get(key);
  if (inFlight) return inFlight;

  let refresh: Promise<AssetSnapshot>;
  refresh = refreshPilotAssetsUncoordinated(input).finally(() => {
    if (inFlightPilotRefreshes.get(key) === refresh) inFlightPilotRefreshes.delete(key);
  });
  inFlightPilotRefreshes.set(key, refresh);
  return refresh;
}

async function refreshPilotAssetsUncoordinated(input: RefreshPilotAssetsInput): Promise<AssetSnapshot> {
  const character = await input.characterStore.getOwned(input.userId, input.character.character_id);
  if (!character) {
    return rejectedSnapshot(input.character, 'Character does not belong to this user.');
  }

  const now = input.now ?? Date.now;

  if (character.needs_reauth === 1) {
    return recordStatus({ ...input, character }, 'Needs re-auth', 'Pilot needs re-authentication.', now());
  }
  if (!character.scopes.split(/\s+/).includes('esi-assets.read_assets.v1')) {
    return recordStatus({ ...input, character }, 'Missing asset scope', 'Pilot is missing esi-assets.read_assets.v1. Click Add character to re-auth.', now());
  }

  try {
    const assets = await (input.fetchAssets ?? getCharacterAssets)(character.character_id);
    const resolveItem = input.resolveItem ?? resolveItemByTypeId;
    const normalized = assets.map(asset => normalizeAsset(asset, resolveItem(asset.type_id) ?? unknownItem(asset.type_id)));
    const unitPrices = await priceAssets(normalized, input.quoteItems ?? quoteResolvedMarketItems);
    const structureCharacterIds = uniqueCharacterIds([character.character_id, ...(input.structureCharacterIds ?? [])]);
    const resolveLocation = input.resolveLocation
      ?? ((locationId, locationType, ownerCharacterId) => resolveAssetLocation(locationId, locationType, ownerCharacterId, structureCharacterIds));
    const locations = await resolveRootLocations(assets, character.character_id, resolveLocation);
    const snapshot = buildAssetTree({
      characterId: character.character_id,
      characterName: character.character_name,
      status: 'Ready',
      error: null,
      lastRefreshedAt: now(),
      locations,
      assets: normalized.map(asset => ({
        ...asset,
        ...(asset.blueprintCopy
          ? { unitValue: null, pricingStatus: 'unpriced' as const }
          : unitPrices.get(asset.typeId) ?? { unitValue: null, pricingStatus: 'unpriced' as const }),
      })),
    });
    await input.store.replaceSnapshot(input.userId, snapshot);
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return recordStatus({ ...input, character }, 'Error', message, now());
  }
}

export async function refreshAllAssets(input: RefreshAllAssetsInput): Promise<AssetSnapshot[]> {
  const refreshOne = input.refreshOne ?? refreshPilotAssets;
  const results = new Array<AssetSnapshot>(input.characters.length);
  const structureCharacterIds = uniqueCharacterIds([
    ...input.characters.map(character => character.character_id),
    ...(input.structureCharacterIds ?? []),
  ]);
  const concurrency = Number.isFinite(input.concurrency) && input.concurrency! > 0
    ? Math.max(1, Math.floor(input.concurrency!))
    : 3;
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= input.characters.length) return;
      const { characters, concurrency: _concurrency, refreshOne: _refreshOne, ...shared } = input;
      const requestedCharacter = characters[index];
      const character = await input.characterStore.getOwned(input.userId, requestedCharacter.character_id);
      results[index] = character
        ? await refreshOne({ ...shared, character, structureCharacterIds })
        : rejectedSnapshot(requestedCharacter, 'Character does not belong to this user.');
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, input.characters.length) }, () => worker()));
  return results;
}

export function summarizeAssets(snapshots: AssetSnapshot[]): AssetDashboardResponse {
  const categories = new Map<AssetCategorySummary['key'], AssetCategorySummary>();
  let lastRefreshedAt: number | null = null;
  const totals = emptySummary();

  for (const snapshot of snapshots) {
    addSummary(totals, snapshot.pilot);
    if (snapshot.pilot.lastRefreshedAt != null) {
      lastRefreshedAt = Math.max(lastRefreshedAt ?? snapshot.pilot.lastRefreshedAt, snapshot.pilot.lastRefreshedAt);
    }
    for (const category of snapshot.categories) {
      const aggregate = categories.get(category.key) ?? { ...category, ...emptySummary() };
      addSummary(aggregate, category);
      categories.set(category.key, aggregate);
    }
  }

  return {
    ...totals,
    pilots: snapshots.map(snapshot => snapshot.pilot),
    categories: [...categories.values()].sort((a, b) => b.totalValue - a.totalValue || a.label.localeCompare(b.label)),
    lastRefreshedAt,
  };
}

export async function resolveAssetLocation(
  locationId: number,
  locationType: string,
  characterId: number,
  structureCharacterIds: number[] = [characterId],
): Promise<RawAssetLocationInput> {
  if (locationType === 'station') {
    return { locationId, name: await resolveStation(locationId), type: 'station', status: 'resolved' };
  }
  if (locationType === 'solar_system') {
    return { locationId, name: await resolveSystem(locationId), type: 'solar_system', status: 'resolved' };
  }
  if (locationType === 'other') {
    for (const resolverCharacterId of uniqueCharacterIds([characterId, ...structureCharacterIds])) {
      const name = await resolveStructure(locationId, resolverCharacterId);
      if (name) return { locationId, name, type: 'structure', status: 'resolved' };
    }
    return { locationId, name: 'Unknown structure', type: 'structure', status: 'unresolved' };
  }
  return { locationId, name: `Unknown location ${locationId}`, type: locationType, status: 'unresolved' };
}

async function recordStatus(
  input: RefreshPilotAssetsInput,
  status: AssetSnapshot['pilot']['status'],
  error: string,
  now: number,
): Promise<AssetSnapshot> {
  await input.store.recordPilotStatus(input.userId, input.character.character_id, input.character.character_name, status, error, now);
  return (await input.store.listSnapshots(input.userId, now))
    .find(snapshot => snapshot.pilot.characterId === input.character.character_id)
    ?? buildAssetTree({
    characterId: input.character.character_id,
    characterName: input.character.character_name,
    status,
    error,
    lastRefreshedAt: null,
    locations: [],
    assets: [],
  });
}

function rejectedSnapshot(character: CharacterRow, error: string): AssetSnapshot {
  return buildAssetTree({
    characterId: character.character_id,
    characterName: character.character_name,
    status: 'Error',
    error,
    lastRefreshedAt: null,
    locations: [],
    assets: [],
  });
}

function unknownItem(typeId: number): AssetItemMetadata {
  return { typeId, name: `Type ${typeId}`, groupId: 0, groupName: 'Unknown', categoryId: 0, categoryName: 'Unknown' };
}

function normalizeAsset(asset: EsiCharacterAsset, item: AssetItemMetadata): Omit<RawAssetInput, 'unitValue' | 'pricingStatus'> {
  return {
    itemId: asset.item_id,
    typeId: asset.type_id,
    name: item.name,
    groupId: item.groupId,
    groupName: item.groupName,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    quantity: asset.quantity,
    singleton: asset.is_singleton,
    blueprintCopy: asset.is_blueprint_copy === true,
    locationId: asset.location_id,
    locationFlag: asset.location_flag,
    locationType: asset.location_type,
  };
}

async function priceAssets(
  assets: Array<Omit<RawAssetInput, 'unitValue' | 'pricingStatus'>>,
  quoteItems: typeof quoteResolvedMarketItems,
) {
  const byType = new Map<number, { asset: Omit<RawAssetInput, 'unitValue' | 'pricingStatus'>; quantity: number }>();
  for (const asset of assets) {
    if (asset.blueprintCopy) continue;
    const current = byType.get(asset.typeId) ?? { asset, quantity: 0 };
    current.quantity += asset.quantity;
    byType.set(asset.typeId, current);
  }
  if (byType.size === 0) return new Map();
  const quote = await quoteItems('jita', [...byType.values()].map(({ asset, quantity }) => ({
    inputName: asset.name,
    resolvedName: asset.name,
    typeId: asset.typeId,
    requestedQty: quantity,
  })));

  return new Map(quote.items.map(item => [
    item.typeId,
    item.avgPrice != null && item.status !== 'no-orders'
      ? { unitValue: item.avgPrice, pricingStatus: item.status === 'partial' ? 'partial' as const : 'priced' as const }
      : { unitValue: null, pricingStatus: 'unpriced' as const },
  ]));
}

async function resolveRootLocations(
  assets: EsiCharacterAsset[],
  characterId: number,
  resolveLocation: NonNullable<RefreshPilotAssetsInput['resolveLocation']>,
): Promise<RawAssetLocationInput[]> {
  const roots = new Map<number, string>();
  for (const asset of assets) {
    if (asset.location_type !== 'item') roots.set(asset.location_id, asset.location_type);
  }
  return Promise.all([...roots].map(async ([locationId, locationType]) => {
    try {
      return await resolveLocation(locationId, locationType, characterId);
    } catch {
      return { locationId, name: `Unknown location ${locationId}`, type: 'unknown', status: 'unresolved' as const };
    }
  }));
}

function emptySummary(): AssetValueSummary {
  return { itemCount: 0, stackCount: 0, pricedValue: 0, totalValue: 0, unpricedStacks: 0 };
}

function addSummary(target: AssetValueSummary, source: AssetValueSummary): void {
  target.itemCount += source.itemCount;
  target.stackCount += source.stackCount;
  target.pricedValue += source.pricedValue;
  target.totalValue += source.totalValue;
  target.unpricedStacks += source.unpricedStacks;
}

function uniqueCharacterIds(characterIds: number[]): number[] {
  return [...new Set(characterIds.filter(id => Number.isSafeInteger(id) && id > 0))];
}
