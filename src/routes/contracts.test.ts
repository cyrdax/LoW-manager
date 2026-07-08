import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { MasteryData } from '../skills/mastery-data.ts';
import { registerContractRoutes } from './contracts.ts';

const data = {
  ships: {
    '17920': {
      name: 'Barghest',
      groupId: 27,
      groupName: 'Battleship',
      requiredSkills: [],
      masteries: [[], [], [], [], []],
    },
  },
} as unknown as MasteryData;

test('GET /api/contracts/ships returns ship suggestions', async () => {
  const app = Fastify();
  registerContractRoutes(app, { loadData: () => data });

  const res = await app.inject({ method: 'GET', url: '/api/contracts/ships?q=bar' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), [{ id: 17920, name: 'Barghest', groupName: 'Battleship' }]);
});

test('GET /api/contracts/search validates required query params', async () => {
  const app = Fastify();
  registerContractRoutes(app, { loadData: () => data });

  const res = await app.inject({ method: 'GET', url: '/api/contracts/search?shipId=17920' });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /originSystemId/);
});

test('GET /api/contracts/search delegates to contract search service', async () => {
  const app = Fastify();
  let observedSignal: AbortSignal | undefined;
  registerContractRoutes(app, {
    loadData: () => data,
    runSearch: async input => {
      observedSignal = input.signal;
      return {
        ship: { id: input.shipId, name: 'Barghest', groupName: 'Battleship' },
        origin: { id: input.originSystemId, name: 'Jita' },
        radius: input.radius,
        regionsScanned: [],
        fetchedAt: 1783526400000,
        results: [],
        warnings: [],
      };
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/search?shipId=17920&originSystemId=30000142&radius=30',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).origin.name, 'Jita');
  assert.ok(observedSignal);
  assert.equal(observedSignal.aborted, false);
});

test('GET /api/contracts/search defaults omitted radius to 30', async () => {
  const app = Fastify();
  let receivedRadius: number | undefined;
  registerContractRoutes(app, {
    loadData: () => data,
    runSearch: async input => {
      receivedRadius = input.radius;
      return {
        ship: { id: input.shipId, name: 'Barghest', groupName: 'Battleship' },
        origin: { id: input.originSystemId, name: 'Jita' },
        radius: input.radius,
        regionsScanned: [],
        fetchedAt: 1783526400000,
        results: [],
        warnings: [],
      };
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/search?shipId=17920&originSystemId=30000142',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(receivedRadius, 30);
  assert.equal(JSON.parse(res.body).radius, 30);
});

test('GET /api/contracts/search rejects radius below the allowed range', async () => {
  const app = Fastify();
  let called = false;
  registerContractRoutes(app, {
    loadData: () => data,
    runSearch: async () => {
      called = true;
      return {
        ship: { id: 17920, name: 'Barghest', groupName: 'Battleship' },
        origin: { id: 30000142, name: 'Jita' },
        radius: 30,
        regionsScanned: [],
        fetchedAt: 1783526400000,
        results: [],
        warnings: [],
      };
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/search?shipId=17920&originSystemId=30000142&radius=0',
  });

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('GET /api/contracts/search rejects radius above the allowed range', async () => {
  const app = Fastify();
  let called = false;
  registerContractRoutes(app, {
    loadData: () => data,
    runSearch: async () => {
      called = true;
      return {
        ship: { id: 17920, name: 'Barghest', groupName: 'Battleship' },
        origin: { id: 30000142, name: 'Jita' },
        radius: 30,
        regionsScanned: [],
        fetchedAt: 1783526400000,
        results: [],
        warnings: [],
      };
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/search?shipId=17920&originSystemId=30000142&radius=101',
  });

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('GET /api/contracts/search returns 400 when origin system is missing from topology', async () => {
  const app = Fastify();
  registerContractRoutes(app, {
    loadData: () => data,
    runSearch: async () => {
      throw new Error('origin system 30000000 is not present in contract map topology');
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/search?shipId=17920&originSystemId=30000000&radius=30',
  });

  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /origin system 30000000 is not present in contract map topology/);
});
