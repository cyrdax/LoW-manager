import type { FastifyInstance } from 'fastify';
import {
  HUBS,
  PLEX_REGION_ID,
  PLEX_REGION_NAME,
  PLEX_TYPE_ID,
  getHistory,
  getOrders,
  quoteShoppingListItems,
  type HubKey,
} from '../market/pricing.ts';

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
    if (!HUBS[hubKey]) return reply.code(400).send({ error: 'hub must be "jita" or "amarr"' });
    const rawItems = Array.isArray(body?.items) ? body!.items : [];
    if (rawItems.length === 0) return reply.code(400).send({ error: 'items list is empty' });
    try {
      const quote = await quoteShoppingListItems(hubKey, rawItems, { log: req.log });
      if (quote.items.length === 0) return reply.code(400).send({ error: 'no valid items in list' });
      return quote;
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
