import type Database from 'better-sqlite3';
import { db as appDb } from '../db.ts';
import type { MasteryData } from '../skills/mastery-data.ts';
import {
  quoteResolvedMarketItems,
  resolveTypeNames,
  type HubKey,
  type MarketQuoteResult,
  type ResolvedMarketRequestItem,
} from '../market/pricing.ts';
import type { ContractSearchResult } from './types.ts';

type SqliteDatabase = Database.Database;

export interface ContractDetailItem {
  recordId: number;
  typeId: number;
  name: string;
  groupName: string;
  categoryName: string;
  quantity: number;
}

export interface ContractDetails {
  contract: Omit<ContractSearchResult, 'shipTypeId' | 'shipName' | 'jumps' | 'capitalJumps'> & {
    locationId: number | null;
  };
  items: ContractDetailItem[];
  quote: MarketQuoteResult;
}

interface SummaryRow {
  contract_id: number;
  region_id: number;
  region_name: string;
  type: 'item_exchange' | 'auction';
  date_issued: string;
  date_expired: string;
  title: string | null;
  price: number | null;
  buyout: number | null;
  location_id: number | null;
  location_system_id: number | null;
  location_system_name: string | null;
  location_name: string | null;
  location_known: number;
}

interface ItemRow {
  record_id: number;
  type_id: number;
  quantity: number;
}

export interface GetContractDetailsInput {
  contractId: number;
  hub: HubKey;
  data: MasteryData;
}

export interface GetContractDetailsDeps {
  database?: SqliteDatabase;
  quoteItems?: (hub: HubKey, items: ResolvedMarketRequestItem[]) => Promise<MarketQuoteResult>;
  resolveTypeNames?: (typeIds: number[]) => Promise<Map<number, string | null>>;
}

export async function getContractDetails(
  input: GetContractDetailsInput,
  deps: GetContractDetailsDeps = {},
): Promise<ContractDetails> {
  const database = deps.database ?? appDb;
  const summary = database.prepare(`
    SELECT
      contract_id,
      region_id,
      region_name,
      type,
      date_issued,
      date_expired,
      title,
      price,
      buyout,
      location_id,
      location_system_id,
      location_system_name,
      location_name,
      location_known
    FROM contract_index_summaries
    WHERE contract_id = ? AND active = 1
  `).get(input.contractId) as SummaryRow | undefined;

  if (!summary) throw new Error('Contract not found');

  const itemRows = database.prepare(`
    SELECT record_id, type_id, quantity
    FROM contract_index_items
    WHERE contract_id = ? AND is_included = 1 AND quantity > 0
    ORDER BY record_id
  `).all(input.contractId) as ItemRow[];

  const missingTypeIds = itemRows
    .map(row => row.type_id)
    .filter(typeId => input.data.ships[String(typeId)] == null && input.data.items[String(typeId)] == null);
  const resolvedNames = missingTypeIds.length > 0
    ? await (deps.resolveTypeNames ?? resolveTypeNames)(missingTypeIds)
    : new Map<number, string | null>();
  const items = itemRows.map(row => contractDetailItem(input.data, row, resolvedNames));
  const quoteItems = items.map(item => ({
    inputName: item.name,
    resolvedName: item.name,
    typeId: item.typeId,
    requestedQty: item.quantity,
    bucket: item.groupName,
  }));
  const quote = await (deps.quoteItems ?? quoteResolvedMarketItems)(input.hub, quoteItems);

  return {
    contract: {
      contractId: summary.contract_id,
      type: summary.type,
      title: summary.title ?? '',
      price: summary.price,
      buyout: summary.buyout,
      effectivePrice: summary.price ?? summary.buyout ?? null,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      regionId: summary.region_id,
      regionName: summary.region_name,
      systemId: summary.location_system_id,
      systemName: summary.location_system_name,
      locationId: summary.location_id,
      locationName: summary.location_name ?? 'Unknown structure',
      locationKnown: summary.location_known === 1,
      dateIssued: summary.date_issued,
      dateExpired: summary.date_expired,
    },
    items,
    quote,
  };
}

function contractDetailItem(
  data: MasteryData,
  row: ItemRow,
  resolvedNames: ReadonlyMap<number, string | null>,
): ContractDetailItem {
  const ship = data.ships[String(row.type_id)];
  if (ship) {
    return {
      recordId: row.record_id,
      typeId: row.type_id,
      name: ship.name,
      groupName: ship.groupName,
      categoryName: 'Ship',
      quantity: row.quantity,
    };
  }

  const item = data.items[String(row.type_id)];
  const resolvedName = resolvedNames.get(row.type_id);
  return {
    recordId: row.record_id,
    typeId: row.type_id,
    name: item?.name ?? resolvedName ?? `Type ${row.type_id}`,
    groupName: item?.groupName ?? 'Unknown',
    categoryName: item?.categoryName ?? 'Unknown',
    quantity: row.quantity,
  };
}
