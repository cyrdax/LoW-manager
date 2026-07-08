import type Database from 'better-sqlite3';
import { db as appDb } from '../db.ts';
import { getPublicContractItemsPage, getPublicContracts } from '../esi/contracts.ts';
import { loadContractMap, type ContractMapTopology } from './map.ts';
import type { PublicContractItem, PublicContractSummary } from './types.ts';
import {
  itemRefreshContractIds,
  markContractItemsFailed,
  nextContractRegionToRefresh,
  replaceContractItems,
  upsertContractIndexRegions,
  upsertRegionContracts,
  type IndexedRegion,
} from './index-store.ts';

type SqliteDatabase = Database.Database;

const FALLBACK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_IDLE_DELAY_MS = 15_000;
const DEFAULT_ERROR_DELAY_MS = 60_000;

export interface ContractRegionPage {
  data: PublicContractSummary[];
  pages: number;
  expiresAt?: number;
}

export interface ContractItemsPage {
  data: PublicContractItem[];
  expiresAt?: number;
}

export interface ContractRegionRefreshResult {
  regionId: number;
  pagesFetched: number;
  contractsSeen: number;
  itemFetches: number;
  itemFailures: number;
}

export interface RefreshContractRegionInput {
  database: SqliteDatabase;
  region: IndexedRegion;
  topology: ContractMapTopology;
  now?: () => number;
  signal?: AbortSignal;
  fetchRegionContracts?: (regionId: number, page: number, signal?: AbortSignal) => Promise<ContractRegionPage>;
  fetchContractItems?: (contractId: number, signal?: AbortSignal) => Promise<ContractItemsPage>;
}

export interface RefreshDueContractRegionInput {
  database: SqliteDatabase;
  topology: ContractMapTopology;
  now?: () => number;
  signal?: AbortSignal;
  fetchRegionContracts?: (regionId: number, page: number, signal?: AbortSignal) => Promise<ContractRegionPage>;
  fetchContractItems?: (contractId: number, signal?: AbortSignal) => Promise<ContractItemsPage>;
}

export interface StartContractIndexerOptions {
  database?: SqliteDatabase;
  topology?: ContractMapTopology;
  now?: () => number;
  idleDelayMs?: number;
  errorDelayMs?: number;
  fetchRegionContracts?: (regionId: number, page: number, signal?: AbortSignal) => Promise<ContractRegionPage>;
  fetchContractItems?: (contractId: number, signal?: AbortSignal) => Promise<ContractItemsPage>;
  logger?: {
    info?: (obj: unknown, message?: string) => void;
    warn?: (obj: unknown, message?: string) => void;
  };
}

export interface ContractIndexerHandle {
  stop(): void;
  kick(): void;
}

export async function refreshContractRegion(input: RefreshContractRegionInput): Promise<ContractRegionRefreshResult> {
  const now = input.now?.() ?? Date.now();
  const fetchRegionContracts = input.fetchRegionContracts ?? defaultFetchRegionContracts;
  const fetchContractItems = input.fetchContractItems ?? defaultFetchContractItems;

  throwIfAborted(input.signal);
  const first = await fetchRegionContracts(input.region.id, 1, input.signal);
  const pages = Math.max(1, first.pages || 1);
  const pageResults: ContractRegionPage[] = [first];
  const deferredPages = Array.from({ length: pages - 1 }, (_, index) => index + 2);

  await runPool(deferredPages, 3, async page => {
    throwIfAborted(input.signal);
    pageResults.push(await fetchRegionContracts(input.region.id, page, input.signal));
  }, input.signal);

  const contracts = pageResults.flatMap(page => page.data);
  const expiresAt = earliestExpiry(pageResults.map(page => page.expiresAt), now);
  upsertRegionContracts(input.database, {
    region: input.region,
    contracts,
    topology: input.topology,
    refreshedAt: now,
    expiresAt,
    pages,
  });

  const contractIds = itemRefreshContractIds(input.database, input.region.id, now);
  let itemFetches = 0;
  let itemFailures = 0;
  await runPool(contractIds, 8, async contractId => {
    throwIfAborted(input.signal);
    try {
      const items = await fetchContractItems(contractId, input.signal);
      replaceContractItems(
        input.database,
        contractId,
        items.data,
        now,
        items.expiresAt ?? now + FALLBACK_TTL_MS,
      );
      itemFetches += 1;
    } catch (err) {
      if (isAbortError(err) || input.signal?.aborted) throw abortError(input.signal?.reason);
      itemFailures += 1;
      markContractItemsFailed(input.database, contractId, now, err instanceof Error ? err.message : 'Failed to fetch items');
    }
  }, input.signal);

  return {
    regionId: input.region.id,
    pagesFetched: pages,
    contractsSeen: contracts.length,
    itemFetches,
    itemFailures,
  };
}

export async function refreshDueContractRegion(
  input: RefreshDueContractRegionInput,
): Promise<ContractRegionRefreshResult | null> {
  const now = input.now?.() ?? Date.now();
  const region = nextContractRegionToRefresh(input.database, now);
  if (!region) return null;

  return refreshContractRegion({ ...input, region });
}

export function startContractIndexer(options: StartContractIndexerOptions = {}): ContractIndexerHandle {
  const database = options.database ?? appDb;
  const topology = options.topology ?? loadContractMap();
  const now = options.now ?? Date.now;
  const idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
  const errorDelayMs = options.errorDelayMs ?? DEFAULT_ERROR_DELAY_MS;
  const controller = new AbortController();
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  upsertContractIndexRegions(database, allRegions(topology), now());

  const schedule = (delay: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await refreshDueContractRegion({
        database,
        topology,
        now,
        signal: controller.signal,
        fetchRegionContracts: options.fetchRegionContracts,
        fetchContractItems: options.fetchContractItems,
      });
      if (result) options.logger?.info?.(result, 'contract index region refreshed');
      running = false;
      schedule(result ? 0 : idleDelayMs);
    } catch (err) {
      running = false;
      if (stopped || controller.signal.aborted) return;
      options.logger?.warn?.(err, 'contract index refresh failed');
      schedule(errorDelayMs);
    }
  };

  schedule(0);

  return {
    stop() {
      stopped = true;
      controller.abort(new Error('Contract indexer stopped'));
      if (timer) clearTimeout(timer);
      timer = null;
    },
    kick() {
      schedule(0);
    },
  };
}

async function defaultFetchRegionContracts(
  regionId: number,
  page: number,
  signal?: AbortSignal,
): Promise<ContractRegionPage> {
  const pageResult = await getPublicContracts(regionId, page, signal);
  return {
    data: pageResult.data,
    pages: pageResult.pages,
    expiresAt: ('expiresAt' in pageResult && typeof pageResult.expiresAt === 'number')
      ? pageResult.expiresAt
      : Date.now() + FALLBACK_TTL_MS,
  };
}

async function defaultFetchContractItems(contractId: number, signal?: AbortSignal): Promise<ContractItemsPage> {
  return getPublicContractItemsPage(contractId, signal);
}

function earliestExpiry(values: Array<number | undefined>, now: number): number {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  return finite.length > 0 ? Math.min(...finite) : now + FALLBACK_TTL_MS;
}

function allRegions(topology: ContractMapTopology): IndexedRegion[] {
  const byId = new Map<number, string>();
  for (const system of topology.systems.values()) {
    byId.set(system.regionId, system.regionName);
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = 0;

  async function worker() {
    while (true) {
      throwIfAborted(signal);
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;

  const err = new Error(typeof reason === 'string' ? reason : 'Aborted');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
