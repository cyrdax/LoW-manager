import { esiGetPublic } from './client.ts';

export interface IndustrySystemCostIndex {
  solar_system_id: number;
  cost_indices: Array<{ activity: string; cost_index: number }>;
}

export interface MarketAdjustedPrice {
  type_id: number;
  adjusted_price?: number;
  average_price?: number;
}

let systemCostCache: { expiresAt: number; data: IndustrySystemCostIndex[] } | null = null;
let adjustedPriceCache: { expiresAt: number; data: Map<number, MarketAdjustedPrice> } | null = null;

export async function getIndustrySystemCostIndices(): Promise<IndustrySystemCostIndex[]> {
  if (systemCostCache && Date.now() < systemCostCache.expiresAt) return systemCostCache.data;
  const { data, expires } = await esiGetPublic<IndustrySystemCostIndex[]>('/industry/systems/');
  systemCostCache = {
    expiresAt: expires ?? Date.now() + 60 * 60 * 1000,
    data,
  };
  return data;
}

export async function getSystemCostIndex(systemId: number): Promise<IndustrySystemCostIndex | null> {
  const systems = await getIndustrySystemCostIndices();
  return systems.find(s => s.solar_system_id === systemId) ?? null;
}

export async function getAdjustedPrices(): Promise<Map<number, MarketAdjustedPrice>> {
  if (adjustedPriceCache && Date.now() < adjustedPriceCache.expiresAt) return adjustedPriceCache.data;
  const { data, expires } = await esiGetPublic<MarketAdjustedPrice[]>('/markets/prices/');
  const byType = new Map<number, MarketAdjustedPrice>();
  for (const row of data) byType.set(row.type_id, row);
  adjustedPriceCache = {
    expiresAt: expires ?? Date.now() + 60 * 60 * 1000,
    data: byType,
  };
  return byType;
}
