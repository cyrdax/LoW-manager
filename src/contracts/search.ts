import type Database from 'better-sqlite3';
import { db as appDb } from '../db.ts';
import { loadContractMap, distancesFrom, regionsWithin, type ContractMapTopology } from './map.ts';
import { LIGHT_YEAR_METERS, jumpDriveRangeAtJdc5 } from './capital-jumps.ts';
import type { MasteryData } from '../skills/mastery-data.ts';
import { sortContractResultsDefault } from './result-sort.ts';
import {
  getContractIndexCoverage,
  prioritizeContractRegions,
  searchIndexedContracts,
  searchIndexedJumpCapableContracts,
  upsertContractIndexRegions,
} from './index-store.ts';
import {
  CONTRACT_RADIUS_DEFAULT,
  CONTRACT_RADIUS_MAX,
  CONTRACT_RADIUS_MIN,
  type ContractSearchResponse,
  type ContractSearchResult,
  type ContractShipHit,
  type ContractWarning,
  type PublicContractItem,
  type PublicContractSummary,
} from './types.ts';

export * from './types.ts';

type SqliteDatabase = Database.Database;

export function searchContractShips(data: MasteryData, q: string, limit = 25): ContractShipHit[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];

  const prefix: ContractShipHit[] = [];
  const substr: ContractShipHit[] = [];

  for (const [id, ship] of Object.entries(data.ships)) {
    const row = { id: Number(id), name: ship.name, groupName: ship.groupName, jumpDriveBaseRangeLy: ship.jumpDriveBaseRangeLy ?? null };
    const name = ship.name.toLowerCase();
    const haystack = `${ship.name} ${ship.groupName}`.toLowerCase();

    if (name.startsWith(query)) {
      prefix.push(row);
    } else if (haystack.includes(query)) {
      substr.push(row);
    }
  }

  prefix.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  substr.sort((a, b) => a.name.localeCompare(b.name));
  return [...prefix, ...substr].slice(0, limit);
}

export function validateContractRadius(raw: number): number {
  if (!Number.isFinite(raw)) return CONTRACT_RADIUS_DEFAULT;

  const radius = Math.floor(raw);
  if (radius < CONTRACT_RADIUS_MIN || radius > CONTRACT_RADIUS_MAX) {
    throw new Error(`radius must be between ${CONTRACT_RADIUS_MIN} and ${CONTRACT_RADIUS_MAX}`);
  }

  return radius;
}

export function matchingShipQuantity(items: PublicContractItem[], shipTypeId: number): number {
  return items.reduce((sum, item) => {
    if (item.type_id !== shipTypeId) return sum;
    if (!item.is_included) return sum;
    if (item.quantity <= 0) return sum;
    return sum + item.quantity;
  }, 0);
}

export function effectiveContractPrice(contract: PublicContractSummary): number | null {
  if (typeof contract.price === 'number') return contract.price;
  if (typeof contract.buyout === 'number') return contract.buyout;
  return null;
}

export function sortContractResults(results: ContractSearchResult[]): ContractSearchResult[] {
  return sortContractResultsDefault(results);
}

export interface RunContractSearchInput {
  data: MasteryData;
  shipId: number;
  originSystemId: number;
  radius: number;
  signal?: AbortSignal;
}

export interface RunJumpCapableContractSearchInput {
  data: MasteryData;
  originSystemId: number;
  signal?: AbortSignal;
}

export interface RunContractSearchDeps {
  database?: SqliteDatabase;
  topology?: ContractMapTopology;
  now?: () => number;
}

export async function runContractSearch(
  input: RunContractSearchInput,
  deps: RunContractSearchDeps = {},
): Promise<ContractSearchResponse> {
  throwIfAborted(input.signal);

  const radius = validateContractRadius(input.radius);
  const ship = input.data.ships[String(input.shipId)];
  if (!ship) throw new Error('Ship not found');

  const topology = deps.topology ?? loadContractMap();
  const now = deps.now?.() ?? Date.now();
  const database = deps.database ?? appDb;
  const distances = distancesFrom(topology, input.originSystemId, radius);
  const regions = regionsWithin(topology, distances);
  const regionIds = regions.map(region => region.id);
  const warnings: ContractWarning[] = [];

  upsertContractIndexRegions(database, regions, now);
  prioritizeContractRegions(database, regionIds, now);
  const coverage = getContractIndexCoverage(database, regionIds, now);
  const indexed = searchIndexedContracts(database, {
    shipTypeId: input.shipId,
    shipName: ship.name,
    jumpDriveBaseRangeLy: ship.jumpDriveBaseRangeLy ?? null,
    originSystemId: input.originSystemId,
    topology,
    regionIds,
    distances,
    now,
  });

  throwIfAborted(input.signal);

  const incompleteRegions = coverage.regionsMissing + coverage.regionsStale;
  if (incompleteRegions > 0) {
    warnings.push({
      code: 'contract_index_warming',
      message: `Contract index warming: ${coverage.regionsReady} of ${coverage.regionsTotal} regions ready`,
      count: incompleteRegions,
    });
  }
  if (indexed.unresolvedLocationCount > 0) {
    warnings.push({
      code: 'contract_locations_unresolved',
      message: 'Skipped contracts in unresolved player structures because jumps cannot be calculated',
      count: indexed.unresolvedLocationCount,
    });
  }

  const originName = topology.systems.get(input.originSystemId)?.name ?? `System ${input.originSystemId}`;
  const index = {
    ...coverage,
    complete: coverage.regionsTotal > 0
      && coverage.regionsReady === coverage.regionsTotal
      && coverage.regionsStale === 0
      && coverage.regionsMissing === 0,
  };

  return {
    ship: { id: input.shipId, name: ship.name, groupName: ship.groupName, jumpDriveBaseRangeLy: ship.jumpDriveBaseRangeLy ?? null },
    origin: { id: input.originSystemId, name: originName },
    radius,
    index,
    regionsScanned: regions,
    fetchedAt: now,
    results: indexed.results,
    warnings,
  };
}

export async function runJumpCapableContractSearch(
  input: RunJumpCapableContractSearchInput,
  deps: RunContractSearchDeps = {},
): Promise<ContractSearchResponse> {
  throwIfAborted(input.signal);

  const topology = deps.topology ?? loadContractMap();
  const now = deps.now?.() ?? Date.now();
  const database = deps.database ?? appDb;
  const distances = distancesFrom(topology, input.originSystemId, CONTRACT_RADIUS_MAX);
  const jumpCapableShips = jumpCapableContractShips(input.data);
  const maxRangeLy = Math.max(...jumpCapableShips.map(ship => jumpDriveRangeAtJdc5(ship.jumpDriveBaseRangeLy) ?? 0));
  const regions = regionsWithinJumpRange(topology, input.originSystemId, maxRangeLy);
  const regionIds = regions.map(region => region.id);
  const warnings: ContractWarning[] = [];

  upsertContractIndexRegions(database, regions, now);
  prioritizeContractRegions(database, regionIds, now);
  const coverage = getContractIndexCoverage(database, regionIds, now);
  const indexed = searchIndexedJumpCapableContracts(database, {
    ships: jumpCapableShips,
    originSystemId: input.originSystemId,
    topology,
    regionIds,
    distances,
    now,
    maxCapitalJumps: 1,
  });

  throwIfAborted(input.signal);

  const incompleteRegions = coverage.regionsMissing + coverage.regionsStale;
  if (incompleteRegions > 0) {
    warnings.push({
      code: 'contract_index_warming',
      message: `Contract index warming: ${coverage.regionsReady} of ${coverage.regionsTotal} regions ready`,
      count: incompleteRegions,
    });
  }
  if (indexed.unresolvedLocationCount > 0) {
    warnings.push({
      code: 'contract_locations_unresolved',
      message: 'Skipped contracts in unresolved player structures because jumps cannot be calculated',
      count: indexed.unresolvedLocationCount,
    });
  }

  const originName = topology.systems.get(input.originSystemId)?.name ?? `System ${input.originSystemId}`;
  const index = {
    ...coverage,
    complete: coverage.regionsTotal > 0
      && coverage.regionsReady === coverage.regionsTotal
      && coverage.regionsStale === 0
      && coverage.regionsMissing === 0,
  };

  return {
    ship: { id: 0, name: 'Any jump-capable ship', groupName: 'Within 1 JDC V jump', jumpDriveBaseRangeLy: null },
    origin: { id: input.originSystemId, name: originName },
    radius: 1,
    index,
    regionsScanned: regions,
    fetchedAt: now,
    results: indexed.results,
    warnings,
  };
}

function jumpCapableContractShips(data: MasteryData) {
  return Object.entries(data.ships)
    .map(([typeId, ship]) => ({
      typeId: Number(typeId),
      name: ship.name,
      jumpDriveBaseRangeLy: ship.jumpDriveBaseRangeLy ?? 0,
    }))
    .filter(ship => Number.isFinite(ship.typeId) && ship.jumpDriveBaseRangeLy > 0);
}

function regionsWithinJumpRange(
  topology: ContractMapTopology,
  originSystemId: number,
  maxRangeLy: number,
): Array<{ id: number; name: string }> {
  const origin = topology.systems.get(originSystemId);
  if (!origin) throw new Error(`origin system ${originSystemId} is not present in contract map topology`);
  if (!hasCoordinates(origin) || maxRangeLy <= 0) return regionsWithin(topology, new Map([[originSystemId, 0]]));

  const systems = new Map<number, number>([[originSystemId, 0]]);
  for (const system of topology.systems.values()) {
    if (!hasCoordinates(system)) continue;
    const distanceLy = Math.hypot(origin.x - system.x, origin.y - system.y, origin.z - system.z) / LIGHT_YEAR_METERS;
    if (distanceLy <= maxRangeLy) systems.set(system.id, 1);
  }

  return regionsWithin(topology, systems);
}

function hasCoordinates(
  system: { x?: number; y?: number; z?: number } | undefined,
): system is { x: number; y: number; z: number } {
  return system != null
    && Number.isFinite(system.x)
    && Number.isFinite(system.y)
    && Number.isFinite(system.z);
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;

  const err = new Error(typeof reason === 'string' ? reason : 'Aborted');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}
