import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateContractIndexDb, replaceContractItems, upsertRegionContracts } from './index-store.ts';
import { getContractDetails } from './detail.ts';
import type { MasteryData } from '../skills/mastery-data.ts';
import type { MarketQuoteResult, ResolvedMarketRequestItem } from '../market/pricing.ts';

const data = {
  _meta: { built_at: '', sde_etag: null, sde_last_modified: null, sde_url: '', counts: { ships: 1, certificates: 0, skills: 0 } },
  ships: {
    '17920': { name: 'Barghest', groupId: 27, groupName: 'Battleship', requiredSkills: [], masteries: [[], [], [], [], []] },
  },
  items: {
    '34': { name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material', requiredSkills: [] },
  },
  certificates: {},
  skills: {},
} satisfies MasteryData;

test('getContractDetails returns included items with market quote estimates', async () => {
  const db = new Database(':memory:');
  migrateContractIndexDb(db);
  upsertRegionContracts(db, {
    region: { id: 10000002, name: 'The Forge' },
    refreshedAt: 1,
    expiresAt: 9_999_999,
    topology: {
      systems: new Map([[30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge', neighbors: [] }]]),
      stations: new Map([[60003760, { stationId: 60003760, stationName: 'Jita IV - Moon 4', solarSystemId: 30000142 }]]),
      adjacency: new Map([[30000142, []]]),
    },
    contracts: [{
      contract_id: 42,
      issuer_id: 1,
      issuer_corporation_id: 2,
      type: 'item_exchange',
      date_issued: '2026-08-01T00:00:00Z',
      date_expired: '2026-08-29T00:00:00Z',
      title: 'Barghest pack',
      price: 1_000_000_000,
      start_location_id: 60003760,
    }],
  });
  replaceContractItems(db, 42, [
    { record_id: 1, type_id: 17920, quantity: 1, is_included: true },
    { record_id: 2, type_id: 34, quantity: 500, is_included: true },
    { record_id: 3, type_id: 35, quantity: 10, is_included: false },
  ], 2, 9_999_999);

  let quotedHub = '';
  let quotedItems: ResolvedMarketRequestItem[] = [];
  const details = await getContractDetails({
    contractId: 42,
    hub: 'jita',
    data,
  }, {
    database: db,
    quoteItems: async (hub, items): Promise<MarketQuoteResult> => {
      quotedHub = hub;
      quotedItems = items;
      return {
        hub,
        systemName: 'Jita',
        regionName: 'The Forge',
        fetchedAt: 3,
        totalCost: 1_000_001_000,
        counts: { ok: 2, partial: 0, noOrders: 0, unknown: 0 },
        items: items.map(item => ({
          inputName: item.inputName,
          resolvedName: item.resolvedName,
          typeId: item.typeId,
          requestedQty: item.requestedQty,
          filledQty: item.requestedQty,
          totalCost: item.typeId === 17920 ? 1_000_000_000 : 1_000,
          avgPrice: item.typeId === 17920 ? 1_000_000_000 : 2,
          shortfall: 0,
          status: 'ok',
          bucket: item.bucket,
        })),
      };
    },
  });

  assert.equal(quotedHub, 'jita');
  assert.deepEqual(quotedItems.map(item => [item.typeId, item.inputName, item.requestedQty, item.bucket]), [
    [17920, 'Barghest', 1, 'Battleship'],
    [34, 'Tritanium', 500, 'Mineral'],
  ]);
  assert.equal(details.contract.contractId, 42);
  assert.equal(details.items.length, 2);
  assert.equal(details.items[0].name, 'Barghest');
  assert.equal(details.quote.totalCost, 1_000_001_000);
});
