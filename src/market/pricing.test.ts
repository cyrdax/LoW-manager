import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  quoteResolvedMarketItems,
  quoteShoppingListItems,
  walkOrderBook,
  type MarketOrder,
} from './pricing.ts';

function order(price: number, volume: number, systemId = 30000142): MarketOrder {
  return {
    order_id: price,
    type_id: 34,
    location_id: 60003760,
    system_id: systemId,
    is_buy_order: false,
    price,
    volume_remain: volume,
    volume_total: volume,
    min_volume: 1,
    duration: 90,
    issued: '2026-07-09T00:00:00Z',
    range: 'region',
  };
}

describe('market pricing', () => {
  it('walks cheapest in-system sell orders first', () => {
    const fill = walkOrderBook([order(30, 5), order(10, 2), order(5, 99, 30002187)], 30000142, 4);
    assert.deepEqual(fill, { totalCost: 80, filledQty: 4, shortfall: 0 });
  });

  it('quotes resolved type IDs without resolving names through ESI', async () => {
    const quote = await quoteResolvedMarketItems('jita', [
      { inputName: 'Tritanium', resolvedName: 'Tritanium', typeId: 34, requestedQty: 4, bucket: 'extras' },
    ], {
      getOrders: async () => [order(10, 2), order(20, 5)],
    });
    assert.equal(quote.totalCost, 60);
    assert.equal(quote.items[0].bucket, 'extras');
    assert.equal(quote.items[0].status, 'ok');
  });

  it('dedupes shopping-list names before quoting', async () => {
    const quote = await quoteShoppingListItems('jita', [
      { name: 'Tritanium', qty: 2 },
      { name: 'Tritanium', qty: 3 },
    ], {
      resolveTypeIds: async names => new Map(names.map(name => [name, 34])),
      getOrders: async () => [order(7, 10)],
    });
    assert.equal(quote.items.length, 1);
    assert.equal(quote.items[0].requestedQty, 5);
    assert.equal(quote.totalCost, 35);
  });
});
