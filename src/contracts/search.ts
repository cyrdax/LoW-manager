import type Database from 'better-sqlite3';
import { db as appDb } from '../db.ts';
import { loadContractMap, distancesFrom, regionsWithin, type ContractMapTopology } from './map.ts';
import { jumpDriveDistancesFrom, jumpDriveRangeAtJdcLevel } from './capital-jumps.ts';
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
  type ContractSearchResponse,
  type ContractSearchResult,
  type ContractShipHit,
  type ContractWarning,
  type PublicContractItem,
  type PublicContractSummary,
} from './types.ts';

export * from './types.ts';

type SqliteDatabase = Database.Database;
const CONTRACT_GATE_DISTANCE_MAX = 100;

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
  jdcLevel?: number;
  maxCynoJumps?: number;
  signal?: AbortSignal;
}

export interface RunJumpCapableContractSearchInput {
  data: MasteryData;
  originSystemId: number;
  jdcLevel?: number;
  maxCynoJumps?: number;
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

  const ship = input.data.ships[String(input.shipId)];
  if (!ship) throw new Error('Ship not found');
  const jdcLevel = input.jdcLevel ?? 5;
  const maxCynoJumps = input.maxCynoJumps ?? 1;
  const jumpRangeLy = jumpDriveRangeAtJdcLevel(ship.jumpDriveBaseRangeLy, jdcLevel);
  if (jumpRangeLy == null) throw new Error('Ship has no jump drive');

  const topology = deps.topology ?? loadContractMap();
  const now = deps.now?.() ?? Date.now();
  const database = deps.database ?? appDb;
  const distances = distancesFrom(topology, input.originSystemId, CONTRACT_GATE_DISTANCE_MAX);
  const capitalDistances = jumpDriveDistancesFrom(
    topology,
    input.originSystemId,
    ship.jumpDriveBaseRangeLy,
    jdcLevel,
    maxCynoJumps,
  );
  const regions = regionsWithin(topology, capitalDistances);
  const regionIds = regions.map(region => region.id);
  const warnings: ContractWarning[] = [];

  upsertContractIndexRegions(database, regions, now);
  prioritizeContractRegions(database, regionIds, now);
  const coverage = getContractIndexCoverage(database, regionIds, now);
  const indexed = searchIndexedContracts(database, {
    shipTypeId: input.shipId,
    shipName: ship.name,
    jumpDriveBaseRangeLy: ship.jumpDriveBaseRangeLy ?? null,
    jdcLevel,
    maxCapitalJumps: maxCynoJumps,
    jumpFuelTypeId: ship.jumpFuelTypeId ?? null,
    jumpFuelTypeName: ship.jumpFuelTypeName ?? null,
    jumpFuelUnitsPerLy: ship.jumpFuelUnitsPerLy ?? null,
    originSystemId: input.originSystemId,
    topology,
    regionIds,
    distances,
    capitalDistances,
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
    jdcLevel,
    maxCynoJumps,
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
  const distances = distancesFrom(topology, input.originSystemId, CONTRACT_GATE_DISTANCE_MAX);
  const jumpCapableShips = jumpCapableContractShips(input.data);
  const jdcLevel = input.jdcLevel ?? 5;
  const maxCynoJumps = input.maxCynoJumps ?? 1;
  const capitalDistancesByBaseRange = new Map<number, Map<number, number>>();
  for (const baseRangeLy of new Set(jumpCapableShips.map(ship => ship.jumpDriveBaseRangeLy))) {
    capitalDistancesByBaseRange.set(baseRangeLy, jumpDriveDistancesFrom(
      topology,
      input.originSystemId,
      baseRangeLy,
      jdcLevel,
      maxCynoJumps,
    ));
  }
  const maxBaseRangeLy = Math.max(...capitalDistancesByBaseRange.keys());
  const regions = regionsWithin(topology, capitalDistancesByBaseRange.get(maxBaseRangeLy) ?? new Map([[input.originSystemId, 0]]));
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
    jdcLevel,
    maxCapitalJumps: maxCynoJumps,
    capitalDistancesByBaseRange,
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
    ship: { id: 0, name: 'Any jump-capable ship', groupName: 'Jump-capable ships', jumpDriveBaseRangeLy: null },
    origin: { id: input.originSystemId, name: originName },
    jdcLevel,
    maxCynoJumps,
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
      jumpFuelTypeId: ship.jumpFuelTypeId ?? null,
      jumpFuelTypeName: ship.jumpFuelTypeName ?? null,
      jumpFuelUnitsPerLy: ship.jumpFuelUnitsPerLy ?? null,
    }))
    .filter(ship => Number.isFinite(ship.typeId) && ship.jumpDriveBaseRangeLy > 0);
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
