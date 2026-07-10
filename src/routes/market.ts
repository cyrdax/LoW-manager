import type { FastifyInstance } from 'fastify';
import { esiPost } from '../esi/client.ts';
import {
  HUBS,
  PLEX_REGION_ID,
  PLEX_REGION_NAME,
  PLEX_TYPE_ID,
  getHistory,
  getOrders,
  quoteShoppingListItems,
  type HubKey,
  type MarketQuoteResult,
} from '../market/pricing.ts';

function formatIskShort(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toString();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Builds the EVEmail HTML body for a shopping-list quote. EVE in-game mail
// renders a restricted HTML subset; `<a href="showinfo:TYPE_ID">Name</a>`
// produces clickable item refs that open the in-game showinfo window with
// a "View Market Details" button.
function formatShoppingMailBody(quote: MarketQuoteResult): string {
  const lines: string[] = [];
  lines.push(`<font size="14"><b>Shopping List - ${quote.systemName}</b></font>`);
  lines.push('');
  for (const it of quote.items) {
    const name = escapeHtml(it.resolvedName ?? it.inputName);
    const link = it.typeId != null ? `<a href="showinfo:${it.typeId}">${name}</a>` : name;
    const qty = it.requestedQty.toLocaleString();
    const segments: string[] = [`${link} x ${qty}`];
    if (it.status === 'ok' || it.status === 'partial') {
      const avg = it.avgPrice != null ? `${formatIskShort(it.avgPrice)} ISK/ea` : '';
      const total = it.totalCost > 0 ? `= ${formatIskShort(it.totalCost)} ISK` : '';
      if (avg) segments.push(avg);
      if (total) segments.push(total);
    }
    if (it.status === 'partial') segments.push(`(partial: ${it.filledQty}/${it.requestedQty})`);
    if (it.status === 'no-orders') segments.push('(no sellers in system)');
    if (it.status === 'unknown-item') segments.push('[unmatched name]');
    lines.push(segments.join(' · '));
  }
  lines.push('');
  lines.push(`<b>Total: ${formatIskShort(quote.totalCost)} ISK</b> (${quote.systemName}, ${quote.regionName})`);
  const flags: string[] = [];
  if (quote.counts.partial > 0) flags.push(`${quote.counts.partial} partial`);
  if (quote.counts.noOrders > 0) flags.push(`${quote.counts.noOrders} no sellers`);
  if (quote.counts.unknown > 0) flags.push(`${quote.counts.unknown} unmatched`);
  if (flags.length > 0) lines.push(`<i>Flags: ${flags.join(', ')}</i>`);
  lines.push('<i>Walk-the-book pricing, cheapest stacks first.</i>');
  return lines.join('<br>');
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

  app.post('/api/market/shopping-list/send', async (req, reply) => {
    const body = req.body as {
      hub?: string;
      items?: Array<{ name?: string; qty?: number }>;
      recipientCharacterId?: number;
    } | undefined;
    const hubKey = (body?.hub ?? '').toLowerCase() as HubKey;
    if (!HUBS[hubKey]) return reply.code(400).send({ error: 'hub must be "jita" or "amarr"' });
    const rawItems = Array.isArray(body?.items) ? body!.items : [];
    if (rawItems.length === 0) return reply.code(400).send({ error: 'items list is empty' });
    const recipientId = Number(body?.recipientCharacterId);
    if (!Number.isFinite(recipientId) || recipientId <= 0) {
      return reply.code(400).send({ error: 'recipientCharacterId required' });
    }

    try {
      const quote = await quoteShoppingListItems(hubKey, rawItems, { log: req.log });
      if (quote.items.length === 0) return reply.code(400).send({ error: 'no valid items in list' });

      const subject = `Shopping list - ${quote.systemName} - ${formatIskShort(quote.totalCost)} ISK`.slice(0, 60);
      const mailBody = formatShoppingMailBody(quote);

      // Self-mail: recipient is also the sender so we use their own token.
      // ESI accepts character → character mail including the same character_id;
      // the message lands in their personal mail tab as "From: <self>".
      const { data } = await esiPost<number | { mail_id?: number }>(
        `/characters/${recipientId}/mail/`,
        recipientId,
        {
          approved_cost: 0,
          subject,
          body: mailBody,
          recipients: [{ recipient_id: recipientId, recipient_type: 'character' }],
        },
      );
      const mailId = typeof data === 'number' ? data : (data?.mail_id ?? null);
      return { ok: true, mailId, quote };
    } catch (err) {
      const e = err as { status?: number; message?: string; body?: string };
      const status = e.status ?? 500;
      // ESI 403 with this scope-missing message is the "needs re-auth" path.
      const reauthHint = status === 403 || (e.body ?? '').includes('esi-mail.send_mail')
        ? 'Pilot is missing the esi-mail.send_mail.v1 scope. Click Add character on that alt to re-auth.'
        : null;
      return reply.code(status).send({
        error: e.message ?? 'failed to send shopping list mail',
        reauthHint,
      });
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
