import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFitDraft } from './assignment.ts';
import { quoteFit } from './pricing.ts';
import type { MarketQuoteResult, ResolvedMarketRequestItem } from '../market/pricing.ts';

const fit = `[Naglfar, Price Test]
Republic Fleet Gyrostabilizer

Pithum C-Type Multispectrum Shield Hardener

Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x10
Definitely Not A Real Module`;

describe('fit pricing', () => {
  it('computes hull fitted extras and grand totals from quote rows', async () => {
    const draft = buildFitDraft(fit);
    const seen: ResolvedMarketRequestItem[] = [];
    const quote = await quoteFit(draft, 'jita', {
      quoteResolvedMarketItems: async (hub, items): Promise<MarketQuoteResult> => {
        assert.equal(hub, 'jita');
        seen.push(...items);
        const quoted = items.map(item => {
          const totalCost = item.bucket === 'hull'
            ? 1_000
            : item.bucket === 'fitted'
              ? 100 * item.requestedQty
              : 2 * item.requestedQty;
          return {
            ...item,
            filledQty: item.requestedQty,
            totalCost,
            avgPrice: totalCost / item.requestedQty,
            shortfall: 0,
            status: 'ok' as const,
          };
        });
        return {
          hub,
          systemName: 'Jita',
          regionName: 'The Forge',
          items: quoted,
          totalCost: quoted.reduce((sum, item) => sum + item.totalCost, 0),
          counts: { ok: quoted.length, partial: 0, noOrders: 0, unknown: 0 },
          fetchedAt: 123,
        };
      },
    });

    assert.equal(seen.some(item => item.bucket === 'hull' && item.inputName === 'Naglfar'), true);
    assert.equal(seen.some(item => item.inputName === 'Definitely Not A Real Module'), false);
    assert.equal(quote.totals.hull, 1_000);
    assert.equal(quote.totals.fitted, 400);
    assert.equal(quote.totals.extras, 20);
    assert.equal(quote.totals.grand, 1_420);
  });
});
