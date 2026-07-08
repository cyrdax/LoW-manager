import type Database from 'better-sqlite3';
import { locationForId, type ContractMapTopology } from './map.ts';
import { sortContractResultsDefault } from './result-sort.ts';
import type { ContractSearchResult, PublicContractItem, PublicContractSummary } from './types.ts';

type SqliteDatabase = Database.Database;

export interface IndexedRegion {
  id: number;
  name: string;
}

export interface UpsertRegionContractsInput {
  region: IndexedRegion;
  contracts: PublicContractSummary[];
  topology: ContractMapTopology;
  refreshedAt: number;
  expiresAt: number;
  pages?: number;
}

export interface IndexedContractSearchInput {
  shipTypeId: number;
  shipName: string;
  regionIds: number[];
  distances: Map<number, number>;
  now: number;
}

export interface IndexedContractSearch {
  results: ContractSearchResult[];
}

export interface ContractIndexCoverage {
  regionsTotal: number;
  regionsReady: number;
  regionsStale: number;
  regionsMissing: number;
  regionsQueued: number;
  oldestRefreshedAt: number | null;
  newestRefreshedAt: number | null;
  activeContracts: number;
  indexedItemContracts: number;
}

export interface IndexedRegionWork {
  id: number;
  name: string;
}

interface ContractIndexSummaryRow {
  contract_id: number;
  region_id: number;
  region_name: string;
  type: 'item_exchange' | 'auction';
  date_issued: string;
  date_expired: string;
  title: string | null;
  price: number | null;
  buyout: number | null;
  location_system_id: number | null;
  location_system_name: string | null;
  location_name: string | null;
  location_known: number;
  quantity: number;
}

interface ContractIndexRegionRow {
  region_id: number;
  region_name: string;
  refreshed_at: number | null;
  expires_at: number | null;
  next_refresh_at: number;
  priority: number;
}

const CONTRACT_TYPES = new Set(['item_exchange', 'auction']);

export function migrateContractIndexDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS contract_index_regions (
      region_id       INTEGER PRIMARY KEY,
      region_name     TEXT NOT NULL,
      refreshed_at    INTEGER,
      expires_at      INTEGER,
      next_refresh_at INTEGER NOT NULL DEFAULT 0,
      page_count      INTEGER,
      priority        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT
    );

    CREATE TABLE IF NOT EXISTS contract_index_summaries (
      contract_id           INTEGER PRIMARY KEY,
      region_id             INTEGER NOT NULL,
      region_name           TEXT NOT NULL,
      issuer_id             INTEGER NOT NULL,
      issuer_corporation_id INTEGER NOT NULL,
      type                  TEXT NOT NULL,
      date_issued           TEXT NOT NULL,
      date_expired          TEXT NOT NULL,
      title                 TEXT,
      price                 REAL,
      buyout                REAL,
      start_location_id     INTEGER,
      end_location_id       INTEGER,
      location_id           INTEGER,
      location_system_id    INTEGER,
      location_system_name  TEXT,
      location_name         TEXT,
      location_known        INTEGER NOT NULL,
      active                INTEGER NOT NULL,
      last_seen_at          INTEGER NOT NULL,
      summary_expires_at    INTEGER NOT NULL,
      items_fetched_at      INTEGER,
      items_expires_at      INTEGER,
      items_error           TEXT,
      FOREIGN KEY (region_id) REFERENCES contract_index_regions(region_id)
    );

    CREATE INDEX IF NOT EXISTS idx_contract_index_summaries_region_active
      ON contract_index_summaries(region_id, active);
    CREATE INDEX IF NOT EXISTS idx_contract_index_summaries_expires
      ON contract_index_summaries(date_expired);
    CREATE INDEX IF NOT EXISTS idx_contract_index_summaries_items_due
      ON contract_index_summaries(active, items_expires_at);

    CREATE TABLE IF NOT EXISTS contract_index_items (
      contract_id INTEGER NOT NULL,
      record_id   INTEGER NOT NULL,
      type_id     INTEGER NOT NULL,
      quantity    INTEGER NOT NULL,
      is_included INTEGER NOT NULL,
      fetched_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      PRIMARY KEY (contract_id, record_id),
      FOREIGN KEY (contract_id) REFERENCES contract_index_summaries(contract_id)
    );

    CREATE INDEX IF NOT EXISTS idx_contract_index_items_type
      ON contract_index_items(type_id, is_included, quantity);
    CREATE INDEX IF NOT EXISTS idx_contract_index_items_contract
      ON contract_index_items(contract_id);
  `);
}

export function upsertContractIndexRegions(database: SqliteDatabase, regions: IndexedRegion[], now: number): void {
  const insert = database.prepare(`
    INSERT INTO contract_index_regions (region_id, region_name, next_refresh_at)
    VALUES (?, ?, ?)
    ON CONFLICT(region_id) DO UPDATE SET
      region_name = excluded.region_name
  `);
  const tx = database.transaction((rows: IndexedRegion[]) => {
    for (const region of rows) insert.run(region.id, region.name, now);
  });
  tx(regions);
}

export function upsertRegionContracts(database: SqliteDatabase, input: UpsertRegionContractsInput): void {
  const regionInsert = database.prepare(`
    INSERT INTO contract_index_regions (
      region_id, region_name, refreshed_at, expires_at, next_refresh_at, page_count, priority, last_error
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
    ON CONFLICT(region_id) DO UPDATE SET
      region_name = excluded.region_name,
      refreshed_at = excluded.refreshed_at,
      expires_at = excluded.expires_at,
      next_refresh_at = excluded.next_refresh_at,
      page_count = excluded.page_count,
      priority = 0,
      last_error = NULL
  `);
  const deactivateRegion = database.prepare(`
    UPDATE contract_index_summaries
    SET active = 0
    WHERE region_id = ?
  `);
  const upsertSummary = database.prepare(`
    INSERT INTO contract_index_summaries (
      contract_id, region_id, region_name, issuer_id, issuer_corporation_id, type,
      date_issued, date_expired, title, price, buyout, start_location_id,
      end_location_id, location_id, location_system_id, location_system_name,
      location_name, location_known, active, last_seen_at, summary_expires_at
    )
    VALUES (
      @contract_id, @region_id, @region_name, @issuer_id, @issuer_corporation_id, @type,
      @date_issued, @date_expired, @title, @price, @buyout, @start_location_id,
      @end_location_id, @location_id, @location_system_id, @location_system_name,
      @location_name, @location_known, 1, @last_seen_at, @summary_expires_at
    )
    ON CONFLICT(contract_id) DO UPDATE SET
      region_id = excluded.region_id,
      region_name = excluded.region_name,
      issuer_id = excluded.issuer_id,
      issuer_corporation_id = excluded.issuer_corporation_id,
      type = excluded.type,
      date_issued = excluded.date_issued,
      date_expired = excluded.date_expired,
      title = excluded.title,
      price = excluded.price,
      buyout = excluded.buyout,
      start_location_id = excluded.start_location_id,
      end_location_id = excluded.end_location_id,
      location_id = excluded.location_id,
      location_system_id = excluded.location_system_id,
      location_system_name = excluded.location_system_name,
      location_name = excluded.location_name,
      location_known = excluded.location_known,
      active = 1,
      last_seen_at = excluded.last_seen_at,
      summary_expires_at = excluded.summary_expires_at
  `);

  const tx = database.transaction(() => {
    regionInsert.run(
      input.region.id,
      input.region.name,
      input.refreshedAt,
      input.expiresAt,
      input.expiresAt,
      input.pages ?? null,
    );
    deactivateRegion.run(input.region.id);

    for (const contract of input.contracts) {
      const locationId = contract.start_location_id ?? contract.end_location_id ?? null;
      const location = locationForId(input.topology, locationId);
      const system = location ? input.topology.systems.get(location.systemId) : null;
      upsertSummary.run({
        contract_id: contract.contract_id,
        region_id: input.region.id,
        region_name: input.region.name,
        issuer_id: contract.issuer_id,
        issuer_corporation_id: contract.issuer_corporation_id,
        type: contract.type,
        date_issued: contract.date_issued,
        date_expired: contract.date_expired,
        title: contract.title ?? null,
        price: contract.price ?? null,
        buyout: contract.buyout ?? null,
        start_location_id: contract.start_location_id ?? null,
        end_location_id: contract.end_location_id ?? null,
        location_id: locationId,
        location_system_id: location?.systemId ?? null,
        location_system_name: system?.name ?? null,
        location_name: location?.name ?? null,
        location_known: location ? 1 : 0,
        last_seen_at: input.refreshedAt,
        summary_expires_at: input.expiresAt,
      });
    }
  });
  tx();
}

export function replaceContractItems(
  database: SqliteDatabase,
  contractId: number,
  items: PublicContractItem[],
  fetchedAt: number,
  expiresAt: number,
): void {
  const clear = database.prepare('DELETE FROM contract_index_items WHERE contract_id = ?');
  const insert = database.prepare(`
    INSERT INTO contract_index_items (
      contract_id, record_id, type_id, quantity, is_included, fetched_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSummary = database.prepare(`
    UPDATE contract_index_summaries
    SET items_fetched_at = ?, items_expires_at = ?, items_error = NULL
    WHERE contract_id = ?
  `);
  const tx = database.transaction(() => {
    clear.run(contractId);
    for (const item of items) {
      insert.run(
        contractId,
        item.record_id,
        item.type_id,
        item.quantity,
        item.is_included ? 1 : 0,
        fetchedAt,
        expiresAt,
      );
    }
    updateSummary.run(fetchedAt, expiresAt, contractId);
  });
  tx();
}

export function markContractItemsFailed(
  database: SqliteDatabase,
  contractId: number,
  attemptedAt: number,
  message: string,
): void {
  database.prepare(`
    UPDATE contract_index_summaries
    SET items_fetched_at = ?, items_error = ?
    WHERE contract_id = ?
  `).run(attemptedAt, message, contractId);
}

export function searchIndexedContracts(
  database: SqliteDatabase,
  input: IndexedContractSearchInput,
): IndexedContractSearch {
  if (input.regionIds.length === 0) return { results: [] };

  const regionFilter = input.regionIds.map(() => '?').join(',');
  const rows = database.prepare(`
    SELECT
      c.contract_id,
      c.region_id,
      c.region_name,
      c.type,
      c.date_issued,
      c.date_expired,
      c.title,
      c.price,
      c.buyout,
      c.location_system_id,
      c.location_system_name,
      c.location_name,
      c.location_known,
      SUM(i.quantity) AS quantity
    FROM contract_index_summaries c
    JOIN contract_index_items i ON i.contract_id = c.contract_id
    WHERE c.region_id IN (${regionFilter})
      AND c.active = 1
      AND c.type IN ('item_exchange', 'auction')
      AND i.type_id = ?
      AND i.is_included = 1
      AND i.quantity > 0
    GROUP BY c.contract_id
  `).all(...input.regionIds, input.shipTypeId) as ContractIndexSummaryRow[];

  const results: ContractSearchResult[] = [];
  for (const row of rows) {
    if (!CONTRACT_TYPES.has(row.type)) continue;
    if (Date.parse(row.date_expired) <= input.now) continue;
    if (row.location_system_id != null && !input.distances.has(row.location_system_id)) continue;

    const jumps = row.location_system_id == null ? null : input.distances.get(row.location_system_id)!;
    results.push({
      contractId: row.contract_id,
      type: row.type,
      title: row.title ?? '',
      price: row.price,
      buyout: row.buyout,
      effectivePrice: row.price ?? row.buyout ?? null,
      quantity: row.quantity,
      shipTypeId: input.shipTypeId,
      shipName: input.shipName,
      regionId: row.region_id,
      regionName: row.region_name,
      systemId: row.location_system_id,
      systemName: row.location_system_name,
      locationName: row.location_name ?? 'Unknown structure',
      locationKnown: row.location_known === 1,
      jumps,
      dateIssued: row.date_issued,
      dateExpired: row.date_expired,
    });
  }

  return { results: sortContractResultsDefault(results) };
}

export function getContractIndexCoverage(
  database: SqliteDatabase,
  regionIds: number[],
  now: number,
): ContractIndexCoverage {
  if (regionIds.length === 0) {
    return emptyCoverage();
  }

  const rows = getRegionRows(database, regionIds);
  const byId = new Map(rows.map(row => [row.region_id, row]));
  let regionsReady = 0;
  let regionsStale = 0;
  let regionsMissing = 0;
  let regionsQueued = 0;
  let oldestRefreshedAt: number | null = null;
  let newestRefreshedAt: number | null = null;

  for (const regionId of regionIds) {
    const row = byId.get(regionId);
    if (!row || row.refreshed_at == null) {
      regionsMissing += 1;
      continue;
    }

    if (row.expires_at != null && row.expires_at > now) regionsReady += 1;
    else regionsStale += 1;
    if (row.priority > 0 || row.next_refresh_at <= now) regionsQueued += 1;
    oldestRefreshedAt = oldestRefreshedAt == null ? row.refreshed_at : Math.min(oldestRefreshedAt, row.refreshed_at);
    newestRefreshedAt = newestRefreshedAt == null ? row.refreshed_at : Math.max(newestRefreshedAt, row.refreshed_at);
  }

  return {
    regionsTotal: regionIds.length,
    regionsReady,
    regionsStale,
    regionsMissing,
    regionsQueued,
    oldestRefreshedAt,
    newestRefreshedAt,
    activeContracts: countActiveContracts(database, regionIds),
    indexedItemContracts: countIndexedItemContracts(database, regionIds),
  };
}

export function prioritizeContractRegions(database: SqliteDatabase, regionIds: number[], now: number): void {
  if (regionIds.length === 0) return;
  const insert = database.prepare(`
    INSERT INTO contract_index_regions (region_id, region_name, next_refresh_at, priority)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(region_id) DO UPDATE SET
      next_refresh_at = MIN(next_refresh_at, excluded.next_refresh_at),
      priority = priority + 1
  `);
  const tx = database.transaction((ids: number[]) => {
    for (const id of ids) insert.run(id, `Region ${id}`, now);
  });
  tx(regionIds);
}

export function nextContractRegionToRefresh(database: SqliteDatabase, now: number): IndexedRegionWork | null {
  const row = database.prepare(`
    SELECT region_id, region_name
    FROM contract_index_regions
    WHERE next_refresh_at <= ?
    ORDER BY priority DESC, refreshed_at IS NOT NULL, COALESCE(refreshed_at, 0), region_name
    LIMIT 1
  `).get(now) as { region_id: number; region_name: string } | undefined;

  return row ? { id: row.region_id, name: row.region_name } : null;
}

export function itemRefreshContractIds(database: SqliteDatabase, regionId: number, now: number): number[] {
  const rows = database.prepare(`
    SELECT contract_id
    FROM contract_index_summaries
    WHERE region_id = ?
      AND active = 1
      AND type IN ('item_exchange', 'auction')
      AND (items_expires_at IS NULL OR items_expires_at <= ?)
      AND date_expired > ?
    ORDER BY contract_id
  `).all(regionId, now, new Date(now).toISOString()) as Array<{ contract_id: number }>;

  return rows.map(row => row.contract_id);
}

function getRegionRows(database: SqliteDatabase, regionIds: number[]): ContractIndexRegionRow[] {
  if (regionIds.length === 0) return [];
  const placeholders = regionIds.map(() => '?').join(',');
  return database.prepare(`
    SELECT region_id, region_name, refreshed_at, expires_at, next_refresh_at, priority
    FROM contract_index_regions
    WHERE region_id IN (${placeholders})
  `).all(...regionIds) as ContractIndexRegionRow[];
}

function countActiveContracts(database: SqliteDatabase, regionIds: number[]): number {
  if (regionIds.length === 0) return 0;
  const placeholders = regionIds.map(() => '?').join(',');
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM contract_index_summaries
    WHERE active = 1 AND region_id IN (${placeholders})
  `).get(...regionIds) as { count: number };
  return row.count;
}

function countIndexedItemContracts(database: SqliteDatabase, regionIds: number[]): number {
  if (regionIds.length === 0) return 0;
  const placeholders = regionIds.map(() => '?').join(',');
  const row = database.prepare(`
    SELECT COUNT(DISTINCT i.contract_id) AS count
    FROM contract_index_items i
    JOIN contract_index_summaries c ON c.contract_id = i.contract_id
    WHERE c.active = 1 AND c.region_id IN (${placeholders})
  `).get(...regionIds) as { count: number };
  return row.count;
}

function emptyCoverage(): ContractIndexCoverage {
  return {
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
