import { getPublicContractItems, getPublicContracts } from '../esi/contracts.ts';
import { resolveSystem } from '../esi/universe.ts';
import { loadContractMap, distancesFrom, locationForId, regionsWithin, type ContractMapTopology } from './map.ts';
import type { MasteryData } from '../skills/mastery-data.ts';
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

export function searchContractShips(data: MasteryData, q: string, limit = 25): ContractShipHit[] {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];

  const prefix: ContractShipHit[] = [];
  const substr: ContractShipHit[] = [];

  for (const [id, ship] of Object.entries(data.ships)) {
    const row = { id: Number(id), name: ship.name, groupName: ship.groupName };
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
  return [...results].sort((a, b) => {
    const aj = a.jumps ?? Number.POSITIVE_INFINITY;
    const bj = b.jumps ?? Number.POSITIVE_INFINITY;
    if (aj !== bj) return aj - bj;

    const ap = a.effectivePrice ?? Number.POSITIVE_INFINITY;
    const bp = b.effectivePrice ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;

    return a.dateExpired.localeCompare(b.dateExpired) || a.contractId - b.contractId;
  });
}

export interface RunContractSearchInput {
  data: MasteryData;
  shipId: number;
  originSystemId: number;
  radius: number;
  signal?: AbortSignal;
}

export interface RunContractSearchDeps {
  topology?: ContractMapTopology;
  now?: () => number;
  resolveSystemName?: (systemId: number) => Promise<string>;
  fetchRegionContracts?: (
    regionId: number,
    page: number,
    signal?: AbortSignal,
  ) => Promise<{ data: PublicContractSummary[]; pages: number }>;
  fetchContractItems?: (contractId: number, signal?: AbortSignal) => Promise<PublicContractItem[]>;
}

const CONTRACT_TYPES = new Set(['item_exchange', 'auction']);

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
  const distances = distancesFrom(topology, input.originSystemId, radius);
  const regions = regionsWithin(topology, distances);
  const resolveSystemName = deps.resolveSystemName ?? resolveSystem;
  const fetchRegionContracts = deps.fetchRegionContracts ?? getPublicContracts;
  const fetchContractItems = deps.fetchContractItems ?? getPublicContractItems;
  const warnings: ContractWarning[] = [];
  const regionFailures = new Map<number, { name: string; count: number }>();
  const deferredPages: DeferredRegionPage[] = [];

  const contracts: Array<{ contract: PublicContractSummary; regionId: number; regionName: string }> = [];
  await runPool(regions, 3, async region => {
    throwIfAborted(input.signal);

    try {
      const first = await fetchRegionContracts(region.id, 1, input.signal);
      for (const c of first.data) contracts.push({ contract: c, regionId: region.id, regionName: region.name });
      for (let page = 2; page <= first.pages; page++) deferredPages.push({ regionId: region.id, regionName: region.name, page });
    } catch (err) {
      if (input.signal?.aborted) throw abortError(input.signal.reason);
      if (isAbortError(err)) throw err;
      incrementRegionFailure(regionFailures, region.id, region.name);
    }
  }, input.signal);
  await runPool(deferredPages, 3, async ({ regionId, regionName, page }) => {
    throwIfAborted(input.signal);

    try {
      const next = await fetchRegionContracts(regionId, page, input.signal);
      for (const c of next.data) contracts.push({ contract: c, regionId, regionName });
    } catch (err) {
      if (input.signal?.aborted) throw abortError(input.signal.reason);
      if (isAbortError(err)) throw err;
      incrementRegionFailure(regionFailures, regionId, regionName);
    }
  }, input.signal);
  for (const { name, count } of regionFailures.values()) {
    warnings.push({ code: 'region_contracts_failed', message: `Failed to load public contracts for ${name}`, count });
  }

  const candidates = contracts
    .filter(({ contract }) => (
      CONTRACT_TYPES.has(contract.type)
      && Date.parse(contract.date_expired) > now
    ))
    .map(entry => {
      const locationId = entry.contract.start_location_id ?? entry.contract.end_location_id ?? null;
      const location = locationForId(topology, locationId);
      const systemId = location?.systemId ?? null;
      return { ...entry, location, systemId };
    })
    .filter(({ systemId }) => systemId == null || distances.has(systemId));

  const results: ContractSearchResult[] = [];
  let itemFailures = 0;
  await runPool(candidates, 8, async ({ contract, regionId, regionName, location, systemId }) => {
    throwIfAborted(input.signal);

    let items: PublicContractItem[];
    try {
      items = await fetchContractItems(contract.contract_id, input.signal);
    } catch (err) {
      if (input.signal?.aborted) throw abortError(input.signal.reason);
      if (isAbortError(err)) throw err;
      itemFailures += 1;
      return;
    }

    throwIfAborted(input.signal);

    const quantity = matchingShipQuantity(items, input.shipId);
    if (quantity <= 0) return;

    const jumps = systemId == null ? null : distances.get(systemId)!;
    const systemName = systemId == null
      ? null
      : topology.systems.get(systemId)?.name ?? await resolveSystemName(systemId).catch(() => `System ${systemId}`);
    const effectivePrice = effectiveContractPrice(contract);

    results.push({
      contractId: contract.contract_id,
      type: contract.type as 'item_exchange' | 'auction',
      title: contract.title ?? '',
      price: contract.price ?? null,
      buyout: contract.buyout ?? null,
      effectivePrice,
      quantity,
      shipTypeId: input.shipId,
      shipName: ship.name,
      regionId,
      regionName,
      systemId,
      systemName,
      locationName: location?.name ?? 'Unknown structure',
      locationKnown: location != null,
      jumps,
      dateIssued: contract.date_issued,
      dateExpired: contract.date_expired,
    });
  }, input.signal);

  if (itemFailures > 0) {
    warnings.push({ code: 'contract_items_failed', message: 'Failed to load items for some contracts', count: itemFailures });
  }

  throwIfAborted(input.signal);

  const originName = topology.systems.get(input.originSystemId)?.name
    ?? await resolveSystemName(input.originSystemId).catch(() => `System ${input.originSystemId}`);

  return {
    ship: { id: input.shipId, name: ship.name, groupName: ship.groupName },
    origin: { id: input.originSystemId, name: originName },
    radius,
    regionsScanned: regions,
    fetchedAt: now,
    results: sortContractResults(results),
    warnings,
  };
}

interface DeferredRegionPage {
  regionId: number;
  regionName: string;
  page: number;
}

function incrementRegionFailure(
  regionFailures: Map<number, { name: string; count: number }>,
  regionId: number,
  regionName: string,
): void {
  const existing = regionFailures.get(regionId);
  if (existing) {
    existing.count += 1;
    return;
  }

  regionFailures.set(regionId, { name: regionName, count: 1 });
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

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
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
      throwIfAborted(signal);
      await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}
