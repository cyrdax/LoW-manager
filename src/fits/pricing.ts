import {
  quoteResolvedMarketItems,
  type HubKey,
  type MarketQuoteResult,
  type QuotedMarketItem,
  type ResolvedMarketRequestItem,
} from '../market/pricing.ts';
import type { AssignedFitItem, FitDraft } from './types.ts';

export type FitPriceBucket = 'hull' | 'fitted' | 'extras';

export interface FitQuoteTotals {
  hull: number;
  fitted: number;
  extras: number;
  grand: number;
}

export interface FitQuote extends MarketQuoteResult {
  items: Array<QuotedMarketItem & { bucket: FitPriceBucket }>;
  totals: FitQuoteTotals;
}

export interface FitPricingDeps {
  quoteResolvedMarketItems?: (
    hub: HubKey,
    items: Array<ResolvedMarketRequestItem & { bucket: FitPriceBucket }>,
  ) => Promise<MarketQuoteResult>;
}

export async function quoteFit(fit: FitDraft, hub: HubKey, deps: FitPricingDeps = {}): Promise<FitQuote> {
  const quote = deps.quoteResolvedMarketItems ?? quoteResolvedMarketItems;
  const marketItems = fitMarketItems(fit);
  const result = await quote(hub, marketItems);
  const items = result.items.map(item => ({
    ...item,
    bucket: (item.bucket ?? 'extras') as FitPriceBucket,
  }));
  const totals = totalBuckets(items);
  return {
    ...result,
    items,
    totalCost: totals.grand,
    totals,
  };
}

export function fitMarketItems(fit: FitDraft): Array<ResolvedMarketRequestItem & { bucket: FitPriceBucket }> {
  const items: Array<ResolvedMarketRequestItem & { bucket: FitPriceBucket }> = [];
  if (fit.ship) {
    items.push({
      inputName: fit.ship.name,
      resolvedName: fit.ship.name,
      typeId: fit.ship.typeId,
      requestedQty: 1,
      bucket: 'hull',
    });
  }

  for (const row of fit.items) {
    const bucket = bucketForRow(row);
    if (!bucket || row.typeId == null) continue;
    items.push({
      inputName: row.resolvedName ?? row.inputName,
      resolvedName: row.resolvedName,
      typeId: row.typeId,
      requestedQty: row.quantity,
      bucket,
    });
  }

  return items;
}

function bucketForRow(row: AssignedFitItem): FitPriceBucket | null {
  if (row.role === 'unmatched') return null;
  if (
    row.role === 'low'
    || row.role === 'mid'
    || row.role === 'high'
    || row.role === 'rig'
    || row.role === 'service'
    || row.role === 'subsystem'
  ) return 'fitted';
  return 'extras';
}

function totalBuckets(items: Array<QuotedMarketItem & { bucket: FitPriceBucket }>): FitQuoteTotals {
  const hull = sumBucket(items, 'hull');
  const fitted = sumBucket(items, 'fitted');
  const extras = sumBucket(items, 'extras');
  return { hull, fitted, extras, grand: hull + fitted + extras };
}

function sumBucket(items: Array<QuotedMarketItem & { bucket: FitPriceBucket }>, bucket: FitPriceBucket): number {
  return items
    .filter(item => item.bucket === bucket)
    .reduce((sum, item) => sum + item.totalCost, 0);
}
