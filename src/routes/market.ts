import type { FastifyInstance } from 'fastify';
import { esiGetPublic, esiPostPublic } from '../esi/client.ts';

// PLEX trades on its own dedicated global region (since 2017, when CCP unified
// the PLEX market). Region 19000001 is the only one that holds PLEX orders +
// history — querying The Forge (10000002) returns an empty array.
const PLEX_TYPE_ID = 44992;
const PLEX_REGION_ID = 19000001;
const PLEX_REGION_NAME = 'Global PLEX Market';

// Trade hubs supported by the shopping-list quote endpoint. Filtering by
// system_id (not station_id) covers Jita 4-4 + the handful of other stations
// in Jita, and similarly any of Amarr's stations.
type HubKey = 'jita' | 'amarr';
const HUBS: Record<HubKey, { systemId: number; regionId: number; systemName: string; regionName: string }> = {
  jita:  { systemId: 30000142, regionId: 10000002, systemName: 'Jita',  regionName: 'The Forge' },
  amarr: { systemId: 30002187, regionId: 10000043, systemName: 'Amarr', regionName: 'Domain' },
};

interface HistoryEntry {
  date: string;          // YYYY-MM-DD
  average: number;
  highest: number;
  lowest: number;
  volume: number;
  order_count: number;
}

interface MarketOrder {
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

interface CacheSlot<T> { data: T; expiresAt: number }
const HISTORY_TTL_MS = 60 * 60 * 1000;  // ESI caches ~23h, we cache 1h to stay fresh
const ORDERS_TTL_MS = 5 * 60 * 1000;    // ESI caches ~5min for orders

const historyCache = new Map<string, CacheSlot<HistoryEntry[]>>();
const ordersCache = new Map<string, CacheSlot<MarketOrder[]>>();

async function getHistory(regionId: number, typeId: number): Promise<HistoryEntry[]> {
  const key = `${regionId}:${typeId}`;
  const hit = historyCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const { data } = await esiGetPublic<HistoryEntry[]>(`/markets/${regionId}/history/?type_id=${typeId}`);
  historyCache.set(key, { data, expiresAt: Date.now() + HISTORY_TTL_MS });
  return data;
}

async function getOrders(regionId: number, typeId: number): Promise<MarketOrder[]> {
  const key = `${regionId}:${typeId}`;
  const hit = ordersCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const { data } = await esiGetPublic<MarketOrder[]>(
    `/markets/${regionId}/orders/?type_id=${typeId}&order_type=all`,
  );
  ordersCache.set(key, { data, expiresAt: Date.now() + ORDERS_TTL_MS });
  return data;
}

// Name → type_id lookup via POST /universe/ids/. Cached forever (type names
// don't change). Unknown names are remembered as `null` to avoid re-asking.
const typeIdCache = new Map<string, number | null>();

async function resolveTypeIds(names: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const toLookup: string[] = [];
  for (const n of names) {
    if (typeIdCache.has(n)) out.set(n, typeIdCache.get(n)!);
    else toLookup.push(n);
  }
  // ESI accepts up to 1000 names per call; batch defensively.
  for (let i = 0; i < toLookup.length; i += 1000) {
    const batch = toLookup.slice(i, i + 1000);
    const { data } = await esiPostPublic<{ inventory_types?: Array<{ id: number; name: string }> }>(
      '/universe/ids/',
      batch,
    );
    const found = new Map<string, number>();
    for (const t of data.inventory_types ?? []) found.set(t.name, t.id);
    for (const name of batch) {
      const id = found.get(name) ?? null;
      typeIdCache.set(name, id);
      out.set(name, id);
    }
  }
  return out;
}

interface OrderBookFill {
  totalCost: number;
  filledQty: number;
  shortfall: number;
}

function walkOrderBook(orders: MarketOrder[], systemId: number, qty: number): OrderBookFill {
  const sells = orders
    .filter(o => !o.is_buy_order && o.system_id === systemId)
    .sort((a, b) => a.price - b.price);
  let remaining = qty;
  let cost = 0;
  for (const o of sells) {
    if (remaining <= 0) break;
    const take = Math.min(o.volume_remain, remaining);
    cost += take * o.price;
    remaining -= take;
  }
  return { totalCost: cost, filledQty: qty - remaining, shortfall: remaining };
}

export function registerMarketRoutes(app: FastifyInstance) {
  app.get('/api/market/plex/history', async (_req, reply) => {
    try {
      const history = await getHistory(PLEX_REGION_ID, PLEX_TYPE_ID);
      return {
        typeId: PLEX_TYPE_ID,
        regionId: PLEX_REGION_ID,
        regionName: PLEX_REGION_NAME,
        history,
      };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      return reply.code(e.status ?? 500).send({ error: e.message ?? 'failed to load history' });
    }
  });

  app.post('/api/market/shopping-list/quote', async (req, reply) => {
    const body = req.body as { hub?: string; items?: Array<{ name?: string; qty?: number }> } | undefined;
    const hubKey = (body?.hub ?? '').toLowerCase() as HubKey;
    const hub = HUBS[hubKey];
    if (!hub) return reply.code(400).send({ error: 'hub must be "jita" or "amarr"' });
    const rawItems = Array.isArray(body?.items) ? body!.items : [];
    if (rawItems.length === 0) return reply.code(400).send({ error: 'items list is empty' });

    // De-dupe input names while preserving the user's intent for repeats:
    // sum quantities if the same item appears twice in the paste.
    const reqByName = new Map<string, number>();
    for (const it of rawItems) {
      const name = (it?.name ?? '').trim();
      const qty = Math.max(0, Math.floor(Number(it?.qty) || 0));
      if (!name || qty === 0) continue;
      reqByName.set(name, (reqByName.get(name) ?? 0) + qty);
    }
    const names = [...reqByName.keys()];
    if (names.length === 0) return reply.code(400).send({ error: 'no valid items in list' });

    try {
      const ids = await resolveTypeIds(names);

      // Fetch orders in parallel per resolved type. Concurrency capped so we
      // don't trip ESI's error budget on huge lists.
      const concurrency = 8;
      type QuotedItem = {
        inputName: string;
        resolvedName: string | null;
        typeId: number | null;
        requestedQty: number;
        filledQty: number;
        totalCost: number;
        avgPrice: number | null;
        shortfall: number;
        status: 'ok' | 'partial' | 'no-orders' | 'unknown-item';
      };
      const results: QuotedItem[] = new Array(names.length);

      let cursor = 0;
      async function worker() {
        while (true) {
          const idx = cursor++;
          if (idx >= names.length) return;
          const inputName = names[idx];
          const requestedQty = reqByName.get(inputName)!;
          const typeId = ids.get(inputName) ?? null;
          if (typeId == null) {
            results[idx] = {
              inputName, resolvedName: null, typeId: null, requestedQty,
              filledQty: 0, totalCost: 0, avgPrice: null, shortfall: requestedQty,
              status: 'unknown-item',
            };
            continue;
          }
          try {
            const orders = await getOrders(hub.regionId, typeId);
            const fill = walkOrderBook(orders, hub.systemId, requestedQty);
            let status: QuotedItem['status'];
            if (fill.filledQty === 0) status = 'no-orders';
            else if (fill.shortfall > 0) status = 'partial';
            else status = 'ok';
            results[idx] = {
              inputName, resolvedName: inputName, typeId, requestedQty,
              filledQty: fill.filledQty, totalCost: fill.totalCost,
              avgPrice: fill.filledQty > 0 ? fill.totalCost / fill.filledQty : null,
              shortfall: fill.shortfall, status,
            };
          } catch (err) {
            const e = err as { message?: string };
            results[idx] = {
              inputName, resolvedName: inputName, typeId, requestedQty,
              filledQty: 0, totalCost: 0, avgPrice: null, shortfall: requestedQty,
              status: 'no-orders',
            };
            req.log?.warn?.({ err: e.message }, `orders fetch failed for ${inputName} (${typeId})`);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, () => worker()));

      let totalCost = 0;
      let okCount = 0, partialCount = 0, noOrdersCount = 0, unknownCount = 0;
      for (const r of results) {
        totalCost += r.totalCost;
        if (r.status === 'ok') okCount++;
        else if (r.status === 'partial') partialCount++;
        else if (r.status === 'no-orders') noOrdersCount++;
        else unknownCount++;
      }

      return {
        hub: hubKey,
        systemName: hub.systemName,
        regionName: hub.regionName,
        items: results,
        totalCost,
        counts: { ok: okCount, partial: partialCount, noOrders: noOrdersCount, unknown: unknownCount },
        fetchedAt: Date.now(),
      };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      return reply.code(e.status ?? 500).send({ error: e.message ?? 'failed to quote shopping list' });
    }
  });

  app.get('/api/market/plex/orders', async (_req, reply) => {
    try {
      const orders = await getOrders(PLEX_REGION_ID, PLEX_TYPE_ID);
      // Reduce to best bid / best ask + overall order counts to keep the response tiny.
      let bestSell = Number.POSITIVE_INFINITY;
      let bestBuy = 0;
      let sellVolume = 0;
      let buyVolume = 0;
      let sellOrders = 0;
      let buyOrders = 0;
      for (const o of orders) {
        if (o.is_buy_order) {
          if (o.price > bestBuy) bestBuy = o.price;
          buyVolume += o.volume_remain;
          buyOrders += 1;
        } else {
          if (o.price < bestSell) bestSell = o.price;
          sellVolume += o.volume_remain;
          sellOrders += 1;
        }
      }
      const finiteSell = Number.isFinite(bestSell) ? bestSell : null;
      const spread = finiteSell != null && bestBuy > 0 ? finiteSell - bestBuy : null;
      return {
        typeId: PLEX_TYPE_ID,
        regionId: PLEX_REGION_ID,
        regionName: PLEX_REGION_NAME,
        bestSell: finiteSell,
        bestBuy: bestBuy > 0 ? bestBuy : null,
        spread,
        sellVolume,
        buyVolume,
        sellOrders,
        buyOrders,
        fetchedAt: Date.now(),
      };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      return reply.code(e.status ?? 500).send({ error: e.message ?? 'failed to load orders' });
    }
  });
}
