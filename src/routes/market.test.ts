import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerMarketRoutes } from './market.ts';

test('market routes do not expose the removed shopping-list EVEmail endpoint', async () => {
  const app = Fastify();
  registerMarketRoutes(app);

  const response = await app.inject({
    method: 'POST',
    url: '/api/market/shopping-list/send',
    payload: {
      hub: 'jita',
      items: [{ name: 'Tritanium', qty: 1 }],
      recipientCharacterId: 9001,
    },
  });

  assert.equal(response.statusCode, 404);
  await app.close();
});
