import type { FastifyBaseLogger } from 'fastify';
import { esiGetPublic, esiPostPublic } from '../esi/client.ts';

// PLEX trades on its own dedicated global region (since 2017, when CCP unified
// the PLEX market). Region 19000001 is the only one that holds PLEX orders +
// history; querying The Forge returns an empty array.
export const PLEX_TYPE_ID = 44992;
export const PLEX_REGION_ID = 19000001;
export const PLEX_REGION_NAME = 'Global PLEX Market';

// Filtering by system_id covers every station in the hub system.
export type HubKey = 'jita' | 'amarr';

export interface HubInfo {
  systemId: number;
  regionId: number;
  systemName: string;
  regionName: string;
}

export const HUBS: Record<HubKey, HubInfo> = {
  jita: { systemId: 30000142, regionId: 10000002, systemName: 'Jita', regionName: 'The Forge' },
  amarr: { systemId: 30002187, regionId: 10000043, systemName: 'Amarr', regionName: 'Domain' },
};

export interface HistoryEntry {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  volume: number;
  order_count: number;
}

export interface MarketOrder {
  order_id: number;
  type_id: number;
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  volume_total: number;
  min_volume: number;
  duration: number;
  issued: string;
  range: string;
}

interface CacheSlot<T> {
  data: T;
  expiresAt: number;
}

const HISTORY_TTL_MS = 60 * 60 * 1000;
const ORDERS_TTL_MS = 5 * 60 * 1000;

const historyCache = new Map<string, CacheSlot<HistoryEntry[]>>();
const ordersCache = new Map<string, CacheSlot<MarketOrder[]>>();
const typeIdCache = new Map<string, number | null>();

export async function getHistory(regionId: number, typeId: number): Promise<HistoryEntry[]> {
  const key = `${regionId}:${typeId}`;
  const hit = historyCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const { data } = await esiGetPublic<HistoryEntry[]>(`/markets/${regionId}/history/?type_id=${typeId}`);
  historyCache.set(key, { data, expiresAt: Date.now() + HISTORY_TTL_MS });
  return data;
}

export async function getOrders(regionId: number, typeId: number): Promise<MarketOrder[]> {
  const key = `${regionId}:${typeId}`;
  const hit = ordersCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const { data } = await esiGetPublic<MarketOrder[]>(
    `/markets/${regionId}/orders/?type_id=${typeId}&order_type=all`,
  );
  ordersCache.set(key, { data, expiresAt: Date.now() + ORDERS_TTL_MS });
  return data;
}

export async function resolveTypeIds(names: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const toLookup: string[] = [];
  for (const name of names) {
    if (typeIdCache.has(name)) out.set(name, typeIdCache.get(name)!);
    else toLookup.push(name);
  }

  for (let i = 0; i < toLookup.length; i += 1000) {
    const batch = toLookup.slice(i, i + 1000);
    const { data } = await esiPostPublic<{ inventory_types?: Array<{ id: number; name: string }> }>(
      '/universe/ids/',
      batch,
    );
    const found = new Map<string, number>();
    for (const type of data.inventory_types ?? []) found.set(type.name, type.id);
    for (const name of batch) {
      const id = found.get(name) ?? null;
      typeIdCache.set(name, id);
      out.set(name, id);
    }
  }

  return out;
}

export interface OrderBookFill {
  totalCost: number;
  filledQty: number;
  shortfall: number;
}

export function walkOrderBook(orders: MarketOrder[], systemId: number, qty: number): OrderBookFill {
  const sells = orders
    .filter(order => !order.is_buy_order && order.system_id === systemId)
    .sort((a, b) => a.price - b.price);
  let remaining = qty;
  let cost = 0;
  for (const order of sells) {
    if (remaining <= 0) break;
    const take = Math.min(order.volume_remain, remaining);
    cost += take * order.price;
    remaining -= take;
  }
  return { totalCost: cost, filledQty: qty - remaining, shortfall: remaining };
}

export type MarketQuoteStatus = 'ok' | 'partial' | 'no-orders' | 'unknown-item';

export interface ResolvedMarketRequestItem {
  inputName: string;
  resolvedName: string | null;
  typeId: number | null;
  requestedQty: number;
  bucket?: string;
}

export interface QuotedMarketItem {
  inputName: string;
  resolvedName: string | null;
  typeId: number | null;
  requestedQty: number;
  filledQty: number;
  totalCost: number;
  avgPrice: number | null;
  shortfall: number;
  status: MarketQuoteStatus;
  bucket?: string;
}

export interface MarketQuoteResult {
  hub: HubKey;
  systemName: string;
  regionName: string;
  items: QuotedMarketItem[];
  totalCost: number;
  counts: { ok: number; partial: number; noOrders: number; unknown: number };
  fetchedAt: number;
}

export interface PricingDeps {
  getOrders?: (regionId: number, typeId: number) => Promise<MarketOrder[]>;
  resolveTypeIds?: (names: string[]) => Promise<Map<string, number | null>>;
  log?: Pick<FastifyBaseLogger, 'warn'>;
}

export async function quoteShoppingListItems(
  hubKey: HubKey,
  rawItems: Array<{ name?: string; qty?: number }>,
  deps: PricingDeps = {},
): Promise<MarketQuoteResult> {
  const reqByName = new Map<string, number>();
  for (const item of rawItems) {
    const name = (item?.name ?? '').trim();
    const qty = Math.max(0, Math.floor(Number(item?.qty) || 0));
    if (!name || qty === 0) continue;
    reqByName.set(name, (reqByName.get(name) ?? 0) + qty);
  }

  const names = [...reqByName.keys()];
  const ids = await (deps.resolveTypeIds ?? resolveTypeIds)(names);
  return quoteResolvedMarketItems(
    hubKey,
    names.map(name => ({
      inputName: name,
      resolvedName: ids.get(name) == null ? null : name,
      typeId: ids.get(name) ?? null,
      requestedQty: reqByName.get(name)!,
    })),
    deps,
  );
}

export async function quoteResolvedMarketItems(
  hubKey: HubKey,
  rawItems: ResolvedMarketRequestItem[],
  deps: PricingDeps = {},
): Promise<MarketQuoteResult> {
  const hub = HUBS[hubKey];
  const items = normalizeResolvedItems(rawItems);
  const ordersFor = deps.getOrders ?? getOrders;

  const concurrency = 8;
  const results: QuotedMarketItem[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const item = items[idx];
      if (item.typeId == null) {
        results[idx] = {
          inputName: item.inputName,
          resolvedName: null,
          typeId: null,
          requestedQty: item.requestedQty,
          filledQty: 0,
          totalCost: 0,
          avgPrice: null,
          shortfall: item.requestedQty,
          status: 'unknown-item',
          bucket: item.bucket,
        };
        continue;
      }

      try {
        const orders = await ordersFor(hub.regionId, item.typeId);
        const fill = walkOrderBook(orders, hub.systemId, item.requestedQty);
        const status: MarketQuoteStatus =
          fill.filledQty === 0 ? 'no-orders' : fill.shortfall > 0 ? 'partial' : 'ok';
        results[idx] = {
          inputName: item.inputName,
          resolvedName: item.resolvedName,
          typeId: item.typeId,
          requestedQty: item.requestedQty,
          filledQty: fill.filledQty,
          totalCost: fill.totalCost,
          avgPrice: fill.filledQty > 0 ? fill.totalCost / fill.filledQty : null,
          shortfall: fill.shortfall,
          status,
          bucket: item.bucket,
        };
      } catch (err) {
        const e = err as { message?: string };
        results[idx] = {
          inputName: item.inputName,
          resolvedName: item.resolvedName,
          typeId: item.typeId,
          requestedQty: item.requestedQty,
          filledQty: 0,
          totalCost: 0,
          avgPrice: null,
          shortfall: item.requestedQty,
          status: 'no-orders',
          bucket: item.bucket,
        };
        deps.log?.warn?.({ err: e.message }, `orders fetch failed for ${item.inputName} (${item.typeId})`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  let totalCost = 0;
  let ok = 0;
  let partial = 0;
  let noOrders = 0;
  let unknown = 0;
  for (const result of results) {
    totalCost += result.totalCost;
    if (result.status === 'ok') ok++;
    else if (result.status === 'partial') partial++;
    else if (result.status === 'no-orders') noOrders++;
    else unknown++;
  }

  return {
    hub: hubKey,
    systemName: hub.systemName,
    regionName: hub.regionName,
    items: results,
    totalCost,
    counts: { ok, partial, noOrders, unknown },
    fetchedAt: Date.now(),
  };
}

function normalizeResolvedItems(rawItems: ResolvedMarketRequestItem[]): ResolvedMarketRequestItem[] {
  const byKey = new Map<string, ResolvedMarketRequestItem>();
  for (const item of rawItems) {
    const qty = Math.max(0, Math.floor(Number(item.requestedQty) || 0));
    const inputName = item.inputName.trim();
    if (!inputName || qty === 0) continue;
    const key = `${item.bucket ?? ''}:${item.typeId ?? inputName.toLowerCase()}`;
    const current = byKey.get(key);
    if (current) {
      current.requestedQty += qty;
    } else {
      byKey.set(key, {
        inputName,
        resolvedName: item.resolvedName,
        typeId: item.typeId,
        requestedQty: qty,
        bucket: item.bucket,
      });
    }
  }
  return [...byKey.values()];
}
