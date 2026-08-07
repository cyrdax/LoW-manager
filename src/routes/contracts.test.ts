import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { MasteryData } from '../skills/mastery-data.ts';
import type { ContractDetails } from '../contracts/detail.ts';
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
  assert.deepEqual(JSON.parse(res.body), [{ id: 17920, name: 'Barghest', groupName: 'Battleship', jumpDriveBaseRangeLy: null }]);
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
        ship: { id: input.shipId, name: 'Barghest', groupName: 'Battleship', jumpDriveBaseRangeLy: null },
        origin: { id: input.originSystemId, name: 'Jita' },
        radius: input.radius,
        regionsScanned: [],
        index: readyIndex(),
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
        ship: { id: input.shipId, name: 'Barghest', groupName: 'Battleship', jumpDriveBaseRangeLy: null },
        origin: { id: input.originSystemId, name: 'Jita' },
        radius: input.radius,
        regionsScanned: [],
        index: readyIndex(),
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
        ship: { id: 17920, name: 'Barghest', groupName: 'Battleship', jumpDriveBaseRangeLy: null },
        origin: { id: 30000142, name: 'Jita' },
        radius: 30,
        regionsScanned: [],
        index: readyIndex(),
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
        ship: { id: 17920, name: 'Barghest', groupName: 'Battleship', jumpDriveBaseRangeLy: null },
        origin: { id: 30000142, name: 'Jita' },
        radius: 30,
        regionsScanned: [],
        index: readyIndex(),
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

function readyIndex() {
  return {
    complete: true,
    regionsTotal: 0,
    regionsReady: 0,
    regionsStale: 0,
    regionsMissing: 0,
    regionsQueued: 0,
    oldestRefreshedAt: null,
    newestRefreshedAt: null,
    activeContracts: 0,
    indexedItemContracts: 0,
  };
}

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

test('GET /api/contracts/:contractId/details returns itemized pricing for a contract', async () => {
  const app = Fastify();
  let observed: { contractId: number; hub: string } | null = null;
  registerContractRoutes(app, {
    loadData: () => data,
    getDetails: async input => {
      observed = { contractId: input.contractId, hub: input.hub };
      return contractDetails(input.contractId);
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/42/details?hub=amarr',
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(observed, { contractId: 42, hub: 'amarr' });
  const body = JSON.parse(res.body);
  assert.equal(body.contract.contractId, 42);
  assert.equal(body.items[0].name, 'Barghest');
  assert.equal(body.quote.totalCost, 1_200_000_000);
});

test('GET /api/contracts/:contractId/details validates hub', async () => {
  const app = Fastify();
  let called = false;
  registerContractRoutes(app, {
    loadData: () => data,
    getDetails: async input => {
      called = true;
      return contractDetails(input.contractId);
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/42/details?hub=perimeter',
  });

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
  assert.match(JSON.parse(res.body).error, /hub/);
});

function contractDetails(contractId: number): ContractDetails {
  return {
    contract: {
      contractId,
      type: 'item_exchange',
      title: 'Barghest pack',
      price: 1_250_000_000,
      buyout: null,
      effectivePrice: 1_250_000_000,
      quantity: 1,
      regionId: 10000002,
      regionName: 'The Forge',
      systemId: 30000142,
      systemName: 'Jita',
      locationId: 60003760,
      locationName: 'Jita IV - Moon 4',
      locationKnown: true,
      dateIssued: '2026-08-01T00:00:00Z',
      dateExpired: '2026-08-29T00:00:00Z',
    },
    items: [
      { recordId: 1, typeId: 17920, name: 'Barghest', groupName: 'Battleship', categoryName: 'Ship', quantity: 1 },
    ],
    quote: {
      hub: 'amarr',
      systemName: 'Amarr',
      regionName: 'Domain',
      fetchedAt: 1783526400000,
      totalCost: 1_200_000_000,
      counts: { ok: 1, partial: 0, noOrders: 0, unknown: 0 },
      items: [{
        inputName: 'Barghest',
        resolvedName: 'Barghest',
        typeId: 17920,
        requestedQty: 1,
        filledQty: 1,
        totalCost: 1_200_000_000,
        avgPrice: 1_200_000_000,
        shortfall: 0,
        status: 'ok',
        bucket: 'Battleship',
      }],
    },
  };
}
