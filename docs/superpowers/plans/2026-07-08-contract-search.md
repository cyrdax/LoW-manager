# Contract Search Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Contracts tab that searches public item-exchange and auction contracts for one selected ship within a default 30-jump radius from a selected origin system.

**Architecture:** Keep ESI, SDE map parsing, route-distance math, and contract filtering on the Fastify server. React owns autocomplete state, persisted form values, loading/error states, and dense result rendering. The implementation is split into pure contract helpers, local SDE topology, ESI wrappers with cache-aware pagination, a route module, and a focused `ContractsView`.

**Tech Stack:** TypeScript, Node 22 test runner, Fastify, React 18, Vite, `better-sqlite3`, `js-yaml`, local `.cache/sde.zip`, EVE ESI public contracts endpoints.

## Global Constraints

- Contracts v1 uses public ESI endpoints only and adds no new EVE SSO scopes.
- Default radius is 30 jumps.
- Accepted radius range is 1 to 100 jumps.
- Search includes only public `item_exchange` and `auction` contracts.
- Search matches only included contract items where `type_id === selectedShipTypeId`, `is_included === true`, and `quantity > 0`.
- Expired contracts are not returned.
- Unknown-location contracts are visible but sort after known-distance rows and render `jumps` as `null`.
- Public contract pages and item rows use ESI `Expires` where available, with a 5 minute fallback TTL.
- Region contract page fetch concurrency is 3.
- Contract item fetch concurrency is 8.
- The map topology is loaded once per server process from `.cache/sde.zip`.
- Missing `.cache/sde.zip` returns a clear setup error telling the user to run `npm run build:mastery`.

---

## File Structure

- Create `src/contracts/types.ts`: shared contract-domain interfaces and constants.
- Create `src/contracts/search.ts`: pure ship search, contract filtering/sorting, and orchestrated contract search service.
- Create `src/contracts/search.test.ts`: tests for ship autocomplete, item filtering, sorting, and partial warnings.
- Create `src/contracts/map.ts`: SDE topology loader, BFS jump calculation, region selection, and station location lookup.
- Create `src/contracts/map.test.ts`: synthetic graph tests for BFS, region selection, and station lookup.
- Create `src/esi/contracts.ts`: public contract ESI wrappers and in-memory caches.
- Modify `src/esi/client.ts`: expose `X-Pages` from ESI responses.
- Create `src/routes/contracts.ts`: Fastify API for ship autocomplete and contract search.
- Create `src/routes/contracts.test.ts`: route validation and normalized response tests using injected dependencies.
- Modify `src/server.ts`: register contract routes.
- Modify `web/src/api.ts`: frontend contract API types and fetch helpers.
- Create `web/src/components/ContractsView.tsx`: Contracts tab UI.
- Modify `web/src/App.tsx`: add `contracts` to the top-level view union and renderer.
- Modify `web/src/components/ControlPanel.tsx`: add Contracts nav button and sidebar help text.
- Modify `web/src/styles.css`: contract tab layout and table styles.
- Modify `README.md`: add Contracts to the top-level view list and document v1 behavior.

---

### Task 1: Contract Domain Helpers

**Files:**
- Create: `src/contracts/types.ts`
- Create: `src/contracts/search.ts`
- Test: `src/contracts/search.test.ts`

**Interfaces:**
- Consumes: `MasteryData` and `MasteryShip` from `src/skills/mastery-data.ts`.
- Produces:
  - `CONTRACT_RADIUS_DEFAULT = 30`
  - `CONTRACT_RADIUS_MIN = 1`
  - `CONTRACT_RADIUS_MAX = 100`
  - `ContractType = 'item_exchange' | 'auction'`
  - `ContractWarning`
  - `PublicContractSummary`
  - `PublicContractItem`
  - `ContractSearchResult`
  - `ContractSearchResponse`
  - `ContractShipHit`
  - `searchContractShips(data: MasteryData, q: string, limit?: number): ContractShipHit[]`
  - `validateContractRadius(raw: number): number`
  - `matchingShipQuantity(items: PublicContractItem[], shipTypeId: number): number`
  - `effectiveContractPrice(contract: PublicContractSummary): number | null`
  - `sortContractResults(results: ContractSearchResult[]): ContractSearchResult[]`

- [ ] **Step 1: Write failing contract helper tests**

Create `src/contracts/search.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MasteryData } from '../skills/mastery-data.ts';
import {
  effectiveContractPrice,
  matchingShipQuantity,
  searchContractShips,
  sortContractResults,
  validateContractRadius,
  type ContractSearchResult,
} from './search.ts';

const masteryData = {
  ships: {
    '17920': { name: 'Barghest', groupId: 27, groupName: 'Battleship', requiredSkills: [], masteries: [[], [], [], [], []] },
    '24688': { name: 'Rokh', groupId: 27, groupName: 'Battleship', requiredSkills: [], masteries: [[], [], [], [], []] },
    '587': { name: 'Rifter', groupId: 25, groupName: 'Frigate', requiredSkills: [], masteries: [[], [], [], [], []] },
  },
} as unknown as MasteryData;

test('searchContractShips returns prefix matches before substring matches', () => {
  const hits = searchContractShips(masteryData, 'bar', 10);
  assert.deepEqual(hits, [{ id: 17920, name: 'Barghest', groupName: 'Battleship' }]);
});

test('searchContractShips requires at least two characters', () => {
  assert.deepEqual(searchContractShips(masteryData, 'b'), []);
});

test('validateContractRadius defaults invalid input and rejects out-of-range values', () => {
  assert.equal(validateContractRadius(Number.NaN), 30);
  assert.equal(validateContractRadius(1), 1);
  assert.equal(validateContractRadius(100), 100);
  assert.throws(() => validateContractRadius(0), /radius must be between 1 and 100/);
  assert.throws(() => validateContractRadius(101), /radius must be between 1 and 100/);
});

test('matchingShipQuantity sums only included positive-quantity ship rows', () => {
  const qty = matchingShipQuantity([
    { record_id: 1, type_id: 17920, quantity: 1, is_included: true },
    { record_id: 2, type_id: 17920, quantity: 2, is_included: true },
    { record_id: 3, type_id: 17920, quantity: 1, is_included: false },
    { record_id: 4, type_id: 24688, quantity: 7, is_included: true },
    { record_id: 5, type_id: 17920, quantity: 0, is_included: true },
  ], 17920);
  assert.equal(qty, 3);
});

test('effectiveContractPrice prefers price, then buyout, then null', () => {
  assert.equal(effectiveContractPrice({ contract_id: 1, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-01-01T00:00:00Z', date_expired: '2026-01-02T00:00:00Z', price: 10 }), 10);
  assert.equal(effectiveContractPrice({ contract_id: 2, type: 'auction', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-01-01T00:00:00Z', date_expired: '2026-01-02T00:00:00Z', buyout: 20 }), 20);
  assert.equal(effectiveContractPrice({ contract_id: 3, type: 'auction', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-01-01T00:00:00Z', date_expired: '2026-01-02T00:00:00Z' }), null);
});

test('sortContractResults sorts known jumps before unknown, then price', () => {
  const rows: ContractSearchResult[] = [
    row(1, null, 1_000),
    row(2, 5, 900),
    row(3, 2, 3_000),
    row(4, 2, 1_000),
    row(5, null, 100),
  ];
  assert.deepEqual(sortContractResults(rows).map(r => r.contractId), [4, 3, 2, 5, 1]);
});

function row(contractId: number, jumps: number | null, effectivePrice: number | null): ContractSearchResult {
  return {
    contractId,
    type: 'item_exchange',
    title: '',
    price: effectivePrice,
    buyout: null,
    effectivePrice,
    quantity: 1,
    shipTypeId: 17920,
    shipName: 'Barghest',
    regionId: 10000002,
    regionName: 'The Forge',
    systemId: jumps == null ? null : 30000142 + jumps,
    systemName: jumps == null ? null : `System ${jumps}`,
    locationName: jumps == null ? 'Unknown structure' : `System ${jumps}`,
    locationKnown: jumps != null,
    jumps,
    dateIssued: '2026-01-01T00:00:00Z',
    dateExpired: '2026-01-02T00:00:00Z',
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/contracts/search.test.ts`

Expected: FAIL with a module-not-found error for `src/contracts/search.ts`.

- [ ] **Step 3: Add contract types**

Create `src/contracts/types.ts`:

```ts
export const CONTRACT_RADIUS_DEFAULT = 30;
export const CONTRACT_RADIUS_MIN = 1;
export const CONTRACT_RADIUS_MAX = 100;

export type ContractType = 'item_exchange' | 'auction';

export interface ContractWarning {
  code: string;
  message: string;
  count?: number;
}

export interface ContractShipHit {
  id: number;
  name: string;
  groupName: string;
}

export interface PublicContractSummary {
  contract_id: number;
  issuer_id: number;
  issuer_corporation_id: number;
  type: string;
  date_issued: string;
  date_expired: string;
  title?: string;
  price?: number;
  buyout?: number;
  start_location_id?: number;
  end_location_id?: number;
}

export interface PublicContractItem {
  record_id: number;
  type_id: number;
  quantity: number;
  is_included: boolean;
}

export interface ContractRegion {
  id: number;
  name: string;
}

export interface ContractOrigin {
  id: number;
  name: string;
}

export interface ContractSearchResult {
  contractId: number;
  type: ContractType;
  title: string;
  price: number | null;
  buyout: number | null;
  effectivePrice: number | null;
  quantity: number;
  shipTypeId: number;
  shipName: string;
  regionId: number;
  regionName: string;
  systemId: number | null;
  systemName: string | null;
  locationName: string;
  locationKnown: boolean;
  jumps: number | null;
  dateIssued: string;
  dateExpired: string;
}

export interface ContractSearchResponse {
  ship: ContractShipHit;
  origin: ContractOrigin;
  radius: number;
  regionsScanned: ContractRegion[];
  fetchedAt: number;
  results: ContractSearchResult[];
  warnings: ContractWarning[];
}
```

- [ ] **Step 4: Add pure helper implementation**

Create `src/contracts/search.ts`:

```ts
import type { MasteryData } from '../skills/mastery-data.ts';
import {
  CONTRACT_RADIUS_DEFAULT,
  CONTRACT_RADIUS_MAX,
  CONTRACT_RADIUS_MIN,
  type ContractSearchResult,
  type ContractShipHit,
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
    if (name.startsWith(query)) prefix.push(row);
    else if (haystack.includes(query)) substr.push(row);
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
```

- [ ] **Step 5: Run tests to verify helper behavior**

Run: `npm test -- src/contracts/search.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit domain helpers**

```bash
git add src/contracts/types.ts src/contracts/search.ts src/contracts/search.test.ts
git commit -m "feat: add contract search helpers"
```

---

### Task 2: Local SDE Map Topology

**Files:**
- Create: `src/contracts/map.ts`
- Test: `src/contracts/map.test.ts`

**Interfaces:**
- Consumes: `.cache/sde.zip`, `js-yaml`, and system `unzip`.
- Produces:
  - `ContractMapTopology`
  - `StationLocation`
  - `buildTopologyFromSystems(systems, stations?): ContractMapTopology`
  - `distancesFrom(topology, originSystemId, radius): Map<number, number>`
  - `regionsWithin(topology, distances): Array<{ id: number; name: string }>`
  - `locationForId(topology, locationId): { systemId: number; name: string } | null`
  - `loadContractMap(): ContractMapTopology`

- [ ] **Step 1: Write failing map tests**

Create `src/contracts/map.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTopologyFromSystems,
  distancesFrom,
  locationForId,
  regionsWithin,
} from './map.ts';

test('distancesFrom computes shortest jumps within radius', () => {
  const topology = buildTopologyFromSystems([
    system(1, 'A', 10, 'Alpha', [2]),
    system(2, 'B', 10, 'Alpha', [1, 3, 4]),
    system(3, 'C', 20, 'Beta', [2]),
    system(4, 'D', 20, 'Beta', [2, 5]),
    system(5, 'E', 30, 'Gamma', [4]),
  ]);

  assert.deepEqual([...distancesFrom(topology, 1, 2).entries()].sort((a, b) => a[0] - b[0]), [
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 2],
  ]);
});

test('regionsWithin returns deduped sorted regions touched by distance map', () => {
  const topology = buildTopologyFromSystems([
    system(1, 'A', 10, 'Alpha', [2]),
    system(2, 'B', 10, 'Alpha', [1, 3]),
    system(3, 'C', 20, 'Beta', [2]),
  ]);
  const distances = distancesFrom(topology, 1, 2);

  assert.deepEqual(regionsWithin(topology, distances), [
    { id: 10, name: 'Alpha' },
    { id: 20, name: 'Beta' },
  ]);
});

test('locationForId resolves system IDs and station IDs', () => {
  const topology = buildTopologyFromSystems(
    [system(1, 'A', 10, 'Alpha', [])],
    [{ stationId: 60000001, stationName: 'A I - Test Station', solarSystemId: 1 }],
  );

  assert.deepEqual(locationForId(topology, 1), { systemId: 1, name: 'A' });
  assert.deepEqual(locationForId(topology, 60000001), { systemId: 1, name: 'A I - Test Station' });
  assert.equal(locationForId(topology, 99000001), null);
});

function system(systemId: number, name: string, regionId: number, regionName: string, neighbors: number[]) {
  return { systemId, name, regionId, regionName, neighbors };
}
```

- [ ] **Step 2: Run map tests to verify they fail**

Run: `npm test -- src/contracts/map.test.ts`

Expected: FAIL with a module-not-found error for `src/contracts/map.ts`.

- [ ] **Step 3: Implement synthetic topology and BFS first**

Create `src/contracts/map.ts` with the pure testable core:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export interface ContractMapSystemInput {
  systemId: number;
  name: string;
  regionId: number;
  regionName: string;
  neighbors: number[];
}

export interface StationLocation {
  stationId: number;
  stationName: string;
  solarSystemId: number;
}

export interface ContractMapTopology {
  systems: Map<number, { id: number; name: string; regionId: number; regionName: string }>;
  adjacency: Map<number, number[]>;
  stations: Map<number, { stationId: number; stationName: string; solarSystemId: number }>;
}

export function buildTopologyFromSystems(
  systems: ContractMapSystemInput[],
  stations: StationLocation[] = [],
): ContractMapTopology {
  const systemMap = new Map<number, { id: number; name: string; regionId: number; regionName: string }>();
  const adjacency = new Map<number, number[]>();
  const stationMap = new Map<number, { stationId: number; stationName: string; solarSystemId: number }>();

  for (const system of systems) {
    systemMap.set(system.systemId, {
      id: system.systemId,
      name: system.name,
      regionId: system.regionId,
      regionName: system.regionName,
    });
    adjacency.set(system.systemId, Array.from(new Set(system.neighbors)).sort((a, b) => a - b));
  }

  for (const station of stations) {
    stationMap.set(station.stationId, station);
  }

  return { systems: systemMap, adjacency, stations: stationMap };
}

export function distancesFrom(topology: ContractMapTopology, originSystemId: number, radius: number): Map<number, number> {
  if (!topology.systems.has(originSystemId)) {
    throw new Error(`origin system ${originSystemId} is not present in contract map topology`);
  }

  const distances = new Map<number, number>([[originSystemId, 0]]);
  const queue = [originSystemId];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const currentDistance = distances.get(current)!;
    if (currentDistance >= radius) continue;
    for (const next of topology.adjacency.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, currentDistance + 1);
      queue.push(next);
    }
  }
  return distances;
}

export function regionsWithin(
  topology: ContractMapTopology,
  distances: Map<number, number>,
): Array<{ id: number; name: string }> {
  const byId = new Map<number, string>();
  for (const systemId of distances.keys()) {
    const system = topology.systems.get(systemId);
    if (system) byId.set(system.regionId, system.regionName);
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function locationForId(
  topology: ContractMapTopology,
  locationId: number | null | undefined,
): { systemId: number; name: string } | null {
  if (locationId == null) return null;
  const system = topology.systems.get(locationId);
  if (system) return { systemId: system.id, name: system.name };
  const station = topology.stations.get(locationId);
  if (station) return { systemId: station.solarSystemId, name: station.stationName };
  return null;
}
```

- [ ] **Step 4: Run tests for pure map behavior**

Run: `npm test -- src/contracts/map.test.ts`

Expected: PASS.

- [ ] **Step 5: Add SDE zip loader to map module**

Extend `src/contracts/map.ts` with runtime loader code:

```ts
interface SdeSolarSystemYaml {
  solarSystemID: number;
  stargates?: Record<string, { destination: number }>;
}

interface SdeRegionYaml {
  regionID: number;
}

interface SdeStationYaml {
  stationID: number;
  stationName: string;
  solarSystemID: number;
}

let cachedTopology: ContractMapTopology | null = null;

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function sdeZipPath(): string {
  return resolve(repoRoot(), '.cache', 'sde.zip');
}

function unzipList(zipPath: string): string[] {
  return execFileSync('unzip', ['-Z', '-1', zipPath], { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function unzipYaml<T>(zipPath: string, member: string): T {
  const text = execFileSync('unzip', ['-p', zipPath, member], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  return yaml.load(text) as T;
}

function displayRegionName(pathPart: string): string {
  return pathPart
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

export function loadContractMap(): ContractMapTopology {
  if (cachedTopology) return cachedTopology;
  const zipPath = sdeZipPath();
  if (!existsSync(zipPath)) {
    throw new Error(`SDE map data missing at ${zipPath}; run \`npm run build:mastery\` to download the SDE cache`);
  }

  const members = unzipList(zipPath);
  const regionFiles = members.filter(m => m.startsWith('universe/eve/') && m.endsWith('/region.yaml'));
  const systemFiles = members.filter(m => m.startsWith('universe/eve/') && m.endsWith('/solarsystem.yaml'));
  const regionByFolder = new Map<string, { id: number; name: string }>();

  for (const regionFile of regionFiles) {
    const parts = regionFile.split('/');
    const regionFolder = parts[2];
    const region = unzipYaml<SdeRegionYaml>(zipPath, regionFile);
    regionByFolder.set(regionFolder, { id: region.regionID, name: displayRegionName(regionFolder) });
  }

  const systems: ContractMapSystemInput[] = [];
  const gateToSystem = new Map<number, number>();
  const systemGateDestinations = new Map<number, number[]>();

  for (const systemFile of systemFiles) {
    const parts = systemFile.split('/');
    const regionFolder = parts[2];
    const systemName = parts[4];
    const region = regionByFolder.get(regionFolder);
    if (!region) continue;
    const system = unzipYaml<SdeSolarSystemYaml>(zipPath, systemFile);
    const gateDestinations: number[] = [];
    for (const [gateIdRaw, gate] of Object.entries(system.stargates ?? {})) {
      const gateId = Number(gateIdRaw);
      gateToSystem.set(gateId, system.solarSystemID);
      gateDestinations.push(gate.destination);
    }
    systems.push({
      systemId: system.solarSystemID,
      name: systemName,
      regionId: region.id,
      regionName: region.name,
      neighbors: [],
    });
    systemGateDestinations.set(system.solarSystemID, gateDestinations);
  }

  for (const system of systems) {
    const neighbors = new Set<number>();
    for (const destinationGateId of systemGateDestinations.get(system.systemId) ?? []) {
      const destinationSystemId = gateToSystem.get(destinationGateId);
      if (destinationSystemId != null && destinationSystemId !== system.systemId) neighbors.add(destinationSystemId);
    }
    system.neighbors = [...neighbors];
  }

  const stationsRaw = unzipYaml<SdeStationYaml[]>(zipPath, 'bsd/staStations.yaml');
  cachedTopology = buildTopologyFromSystems(
    systems,
    stationsRaw.map(s => ({
      stationId: s.stationID,
      stationName: s.stationName,
      solarSystemId: s.solarSystemID,
    })),
  );
  return cachedTopology;
}
```

- [ ] **Step 6: Add real SDE smoke assertions**

Append to `src/contracts/map.test.ts`:

```ts
test('loadContractMap resolves Jita and Jita 4-4 from bundled SDE cache', () => {
  const { loadContractMap } = await import('./map.ts');
  const topology = loadContractMap();
  const jita = locationForId(topology, 30000142);
  const jita44 = locationForId(topology, 60003760);

  assert.equal(jita?.name, 'Jita');
  assert.equal(jita44?.systemId, 30000142);
  assert.match(jita44?.name ?? '', /Jita/);
});
```

- [ ] **Step 7: Run map tests**

Run: `npm test -- src/contracts/map.test.ts`

Expected: PASS. If this fails because `.cache/sde.zip` is missing, run `npm run build:mastery`, then rerun the test.

- [ ] **Step 8: Commit map topology**

```bash
git add src/contracts/map.ts src/contracts/map.test.ts
git commit -m "feat: add contract map topology"
```

---

### Task 3: ESI Contract Wrappers and Search Service

**Files:**
- Modify: `src/esi/client.ts`
- Create: `src/esi/contracts.ts`
- Modify: `src/contracts/search.ts`
- Test: `src/contracts/search.test.ts`

**Interfaces:**
- Consumes:
  - `esiGetPublic<T>(path): Promise<EsiResponse<T>>`
  - `loadContractMap()`
  - `resolveSystem(id)`
- Produces:
  - `getPublicContracts(regionId: number, page?: number)`
  - `getPublicContractItems(contractId: number)`
  - `runContractSearch(input, deps?)`

- [ ] **Step 1: Add failing service tests**

Append to `src/contracts/search.test.ts`:

```ts
import { runContractSearch } from './search.ts';

test('runContractSearch returns active matching contracts with distances', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => id === 30000142 ? 'Jita' : `System ${id}`,
    topology: {
      systems: new Map([
        [30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }],
        [30000145, { id: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge' }],
      ]),
      adjacency: new Map([[30000142, [30000145]], [30000145, [30000142]]]),
      stations: new Map([[60003760, { stationId: 60003760, stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', solarSystemId: 30000142 }]]),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 1, type: 'item_exchange', issuer_id: 9, issuer_corporation_id: 10, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 50, start_location_id: 60003760, title: 'Barghest hull' },
        { contract_id: 2, type: 'courier', issuer_id: 9, issuer_corporation_id: 10, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', start_location_id: 60003760 },
        { contract_id: 3, type: 'item_exchange', issuer_id: 9, issuer_corporation_id: 10, date_issued: '2026-07-01T00:00:00Z', date_expired: '2026-07-02T00:00:00Z', price: 5, start_location_id: 60003760 },
      ],
      pages: 1,
    }),
    fetchContractItems: async contractId => contractId === 1
      ? [{ record_id: 11, type_id: 17920, quantity: 1, is_included: true }]
      : [],
  });

  assert.equal(response.ship.name, 'Barghest');
  assert.equal(response.origin.name, 'Jita');
  assert.deepEqual(response.regionsScanned, [{ id: 10000002, name: 'The Forge' }]);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].contractId, 1);
  assert.equal(response.results[0].quantity, 1);
  assert.equal(response.results[0].jumps, 0);
  assert.equal(response.results[0].locationName, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant');
});

test('runContractSearch keeps unknown-location matches after known-distance matches', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => `System ${id}`,
    topology: {
      systems: new Map([[30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }]]),
      adjacency: new Map([[30000142, []]]),
      stations: new Map(),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 10, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 10, start_location_id: 99000001 },
        { contract_id: 11, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 30000142 },
      ],
      pages: 1,
    }),
    fetchContractItems: async () => [{ record_id: 1, type_id: 17920, quantity: 1, is_included: true }],
  });

  assert.deepEqual(response.results.map(r => r.contractId), [11, 10]);
  assert.equal(response.results[1].locationKnown, false);
  assert.equal(response.results[1].jumps, null);
});

test('runContractSearch returns partial warning when an item fetch fails', async () => {
  const response = await runContractSearch({
    data: masteryData,
    shipId: 17920,
    originSystemId: 30000142,
    radius: 30,
  }, {
    now: () => Date.parse('2026-07-08T00:00:00Z'),
    resolveSystemName: async id => `System ${id}`,
    topology: {
      systems: new Map([[30000142, { id: 30000142, name: 'Jita', regionId: 10000002, regionName: 'The Forge' }]]),
      adjacency: new Map([[30000142, []]]),
      stations: new Map(),
    },
    fetchRegionContracts: async () => ({
      data: [
        { contract_id: 21, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 30000142 },
        { contract_id: 22, type: 'item_exchange', issuer_id: 1, issuer_corporation_id: 2, date_issued: '2026-07-07T00:00:00Z', date_expired: '2026-07-09T00:00:00Z', price: 20, start_location_id: 30000142 },
      ],
      pages: 1,
    }),
    fetchContractItems: async contractId => {
      if (contractId === 22) throw new Error('ESI failed');
      return [{ record_id: 1, type_id: 17920, quantity: 1, is_included: true }];
    },
  });

  assert.equal(response.results.length, 1);
  assert.equal(response.warnings.length, 1);
  assert.equal(response.warnings[0].code, 'contract_items_failed');
  assert.equal(response.warnings[0].count, 1);
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run: `npm test -- src/contracts/search.test.ts`

Expected: FAIL because `runContractSearch` is not exported.

- [ ] **Step 3: Expose ESI page count**

Modify `src/esi/client.ts`:

```ts
export interface EsiResponse<T> {
  data: T;
  status: number;
  expires: number | null;
  etag: string | null;
  pages: number | null;
}
```

Inside `esiFetch`, parse `X-Pages`:

```ts
const pagesHeader = res.headers.get('X-Pages');
const pages = pagesHeader ? Number(pagesHeader) : null;
```

Return:

```ts
return { data, status: res.status, expires, etag: res.headers.get('ETag'), pages };
```

- [ ] **Step 4: Add public contract ESI wrappers**

Create `src/esi/contracts.ts`:

```ts
import { esiGetPublic } from './client.ts';
import type { PublicContractItem, PublicContractSummary } from '../contracts/types.ts';

interface CacheSlot<T> { data: T; expiresAt: number; pages?: number | null }

const FALLBACK_TTL_MS = 5 * 60 * 1000;
const contractPageCache = new Map<string, CacheSlot<PublicContractSummary[]>>();
const contractItemsCache = new Map<number, CacheSlot<PublicContractItem[]>>();

function expiry(expires: number | null): number {
  return expires && Number.isFinite(expires) ? expires : Date.now() + FALLBACK_TTL_MS;
}

export async function getPublicContracts(
  regionId: number,
  page = 1,
): Promise<{ data: PublicContractSummary[]; pages: number }> {
  const key = `${regionId}:${page}`;
  const hit = contractPageCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { data: hit.data, pages: hit.pages ?? 1 };
  }

  const res = await esiGetPublic<PublicContractSummary[]>(`/contracts/public/${regionId}/?page=${page}`);
  const pages = res.pages ?? 1;
  contractPageCache.set(key, { data: res.data, expiresAt: expiry(res.expires), pages });
  return { data: res.data, pages };
}

export async function getPublicContractItems(contractId: number): Promise<PublicContractItem[]> {
  const hit = contractItemsCache.get(contractId);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const res = await esiGetPublic<PublicContractItem[]>(`/contracts/public/items/${contractId}/`);
  contractItemsCache.set(contractId, { data: res.data, expiresAt: expiry(res.expires) });
  return res.data;
}
```

- [ ] **Step 5: Implement contract search orchestration**

Extend `src/contracts/search.ts`:

```ts
import { getPublicContractItems, getPublicContracts } from '../esi/contracts.ts';
import { resolveSystem } from '../esi/universe.ts';
import { loadContractMap, distancesFrom, locationForId, regionsWithin, type ContractMapTopology } from './map.ts';
import type {
  ContractSearchResponse,
  ContractWarning,
  PublicContractSummary,
} from './types.ts';

export interface RunContractSearchInput {
  data: MasteryData;
  shipId: number;
  originSystemId: number;
  radius: number;
}

export interface RunContractSearchDeps {
  topology?: ContractMapTopology;
  now?: () => number;
  resolveSystemName?: (systemId: number) => Promise<string>;
  fetchRegionContracts?: (regionId: number, page: number) => Promise<{ data: PublicContractSummary[]; pages: number }>;
  fetchContractItems?: (contractId: number) => Promise<PublicContractItem[]>;
}

const CONTRACT_TYPES = new Set(['item_exchange', 'auction']);

export async function runContractSearch(
  input: RunContractSearchInput,
  deps: RunContractSearchDeps = {},
): Promise<ContractSearchResponse> {
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

  const contracts: Array<{ contract: PublicContractSummary; regionId: number; regionName: string }> = [];
  await runPool(regions, 3, async region => {
    try {
      const first = await fetchRegionContracts(region.id, 1);
      for (const c of first.data) contracts.push({ contract: c, regionId: region.id, regionName: region.name });
      for (let page = 2; page <= first.pages; page++) {
        const next = await fetchRegionContracts(region.id, page);
        for (const c of next.data) contracts.push({ contract: c, regionId: region.id, regionName: region.name });
      }
    } catch {
      warnings.push({ code: 'region_contracts_failed', message: `Failed to load public contracts for ${region.name}`, count: 1 });
    }
  });

  const candidates = contracts.filter(({ contract }) => (
    CONTRACT_TYPES.has(contract.type)
    && Date.parse(contract.date_expired) > now
  ));

  const results: ContractSearchResult[] = [];
  let itemFailures = 0;
  await runPool(candidates, 8, async ({ contract, regionId, regionName }) => {
    let items: PublicContractItem[];
    try {
      items = await fetchContractItems(contract.contract_id);
    } catch {
      itemFailures += 1;
      return;
    }

    const quantity = matchingShipQuantity(items, input.shipId);
    if (quantity <= 0) return;

    const locationId = contract.start_location_id ?? contract.end_location_id ?? null;
    const location = locationForId(topology, locationId);
    const systemId = location?.systemId ?? null;
    const jumps = systemId == null ? null : distances.get(systemId) ?? null;
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
  });

  if (itemFailures > 0) {
    warnings.push({ code: 'contract_items_failed', message: 'Failed to load items for some contracts', count: itemFailures });
  }

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

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}
```

- [ ] **Step 6: Run contract service tests**

Run: `npm test -- src/contracts/search.test.ts`

Expected: PASS.

- [ ] **Step 7: Run full backend tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit service layer**

```bash
git add src/esi/client.ts src/esi/contracts.ts src/contracts/search.ts src/contracts/search.test.ts
git commit -m "feat: search public ship contracts"
```

---

### Task 4: Contract API Routes

**Files:**
- Create: `src/routes/contracts.ts`
- Create: `src/routes/contracts.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes:
  - `searchContractShips(data, q)`
  - `runContractSearch(input, deps?)`
  - `loadMasteryData()`
- Produces:
  - `registerContractRoutes(app, deps?)`
  - `GET /api/contracts/ships?q=<query>`
  - `GET /api/contracts/search?shipId=<id>&originSystemId=<id>&radius=<n>`

- [ ] **Step 1: Write failing route tests**

Create `src/routes/contracts.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { MasteryData } from '../skills/mastery-data.ts';
import { registerContractRoutes } from './contracts.ts';

const data = {
  ships: {
    '17920': { name: 'Barghest', groupId: 27, groupName: 'Battleship', requiredSkills: [], masteries: [[], [], [], [], []] },
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
  registerContractRoutes(app, {
    loadData: () => data,
    runSearch: async input => ({
      ship: { id: input.shipId, name: 'Barghest', groupName: 'Battleship' },
      origin: { id: input.originSystemId, name: 'Jita' },
      radius: input.radius,
      regionsScanned: [],
      fetchedAt: 1783526400000,
      results: [],
      warnings: [],
    }),
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/contracts/search?shipId=17920&originSystemId=30000142&radius=30',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).origin.name, 'Jita');
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `npm test -- src/routes/contracts.test.ts`

Expected: FAIL with a module-not-found error for `src/routes/contracts.ts`.

- [ ] **Step 3: Implement route module with injectable dependencies**

Create `src/routes/contracts.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadMasteryData, type MasteryData } from '../skills/mastery-data.ts';
import {
  CONTRACT_RADIUS_DEFAULT,
  runContractSearch,
  searchContractShips,
  type ContractSearchResponse,
  type RunContractSearchInput,
} from '../contracts/search.ts';

const shipQuery = z.object({
  q: z.string().optional(),
});

const searchQuery = z.object({
  shipId: z.coerce.number().int().positive(),
  originSystemId: z.coerce.number().int().positive(),
  radius: z.coerce.number().int().default(CONTRACT_RADIUS_DEFAULT),
});

export interface ContractRouteDeps {
  loadData?: () => MasteryData;
  runSearch?: (input: RunContractSearchInput) => Promise<ContractSearchResponse>;
}

export function registerContractRoutes(app: FastifyInstance, deps: ContractRouteDeps = {}) {
  const loadData = deps.loadData ?? loadMasteryData;
  const runSearch = deps.runSearch ?? runContractSearch;

  app.get<{ Querystring: { q?: string } }>('/api/contracts/ships', async (req, reply) => {
    const parsed = shipQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return searchContractShips(loadData(), parsed.data.q ?? '');
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/contracts/search', async (req, reply) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    try {
      return await runSearch({
        data: loadData(),
        shipId: parsed.data.shipId,
        originSystemId: parsed.data.originSystemId,
        radius: parsed.data.radius,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search contracts';
      if (message === 'Ship not found') return reply.code(404).send({ error: message });
      if (message.includes('radius must be between')) return reply.code(400).send({ error: message });
      if (message.includes('SDE map data missing')) return reply.code(500).send({ error: message });
      if (message.includes('origin system')) return reply.code(400).send({ error: message });
      return reply.code(500).send({ error: message });
    }
  });
}
```

- [ ] **Step 4: Register route in server**

Modify `src/server.ts`:

```ts
import { registerContractRoutes } from './routes/contracts.ts';
```

After `registerIndustryRoutes(app);`, add:

```ts
registerContractRoutes(app);
```

- [ ] **Step 5: Run route tests**

Run: `npm test -- src/routes/contracts.test.ts`

Expected: PASS.

- [ ] **Step 6: Run full backend tests and typecheck**

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit contract routes**

```bash
git add src/routes/contracts.ts src/routes/contracts.test.ts src/server.ts
git commit -m "feat: expose contract search api"
```

---

### Task 5: Contracts Tab UI

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/ContractsView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ControlPanel.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes:
  - `GET /api/contracts/ships`
  - `GET /api/contracts/search`
  - existing `searchSystems(q, signal)`
- Produces:
  - `searchContractShips(q, signal)`
  - `searchContracts(params, signal)`
  - `ContractsView`
  - top-level `contracts` sidebar tab

- [ ] **Step 1: Add frontend API types and helpers**

Modify `web/src/api.ts` near the other search/helper exports:

```ts
export interface ContractShipHit {
  id: number;
  name: string;
  groupName: string;
}

export interface ContractWarning {
  code: string;
  message: string;
  count?: number;
}

export interface ContractSearchResult {
  contractId: number;
  type: 'item_exchange' | 'auction';
  title: string;
  price: number | null;
  buyout: number | null;
  effectivePrice: number | null;
  quantity: number;
  shipTypeId: number;
  shipName: string;
  regionId: number;
  regionName: string;
  systemId: number | null;
  systemName: string | null;
  locationName: string;
  locationKnown: boolean;
  jumps: number | null;
  dateIssued: string;
  dateExpired: string;
}

export interface ContractSearchResponse {
  ship: ContractShipHit;
  origin: { id: number; name: string };
  radius: number;
  regionsScanned: Array<{ id: number; name: string }>;
  fetchedAt: number;
  results: ContractSearchResult[];
  warnings: ContractWarning[];
}

export async function searchContractShips(q: string, signal?: AbortSignal): Promise<ContractShipHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/contracts/ships?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function searchContracts(
  params: { shipId: number; originSystemId: number; radius: number },
  signal?: AbortSignal,
): Promise<ContractSearchResponse | { error: string }> {
  const qs = new URLSearchParams({
    shipId: String(params.shipId),
    originSystemId: String(params.originSystemId),
    radius: String(params.radius),
  });
  const res = await fetch(`/api/contracts/search?${qs.toString()}`, { signal });
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}
```

- [ ] **Step 2: Create ContractsView component**

Create `web/src/components/ContractsView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  searchContractShips,
  searchContracts,
  searchSystems,
  type ContractSearchResponse,
  type ContractSearchResult,
  type ContractShipHit,
  type SystemHit,
} from '../api.ts';

const SHIP_ID_KEY = 'efd.contracts.shipId';
const SHIP_NAME_KEY = 'efd.contracts.shipName';
const SHIP_GROUP_KEY = 'efd.contracts.shipGroupName';
const ORIGIN_ID_KEY = 'efd.contracts.originSystemId';
const ORIGIN_NAME_KEY = 'efd.contracts.originSystemName';
const RADIUS_KEY = 'efd.contracts.radius';

export function ContractsView() {
  const [shipText, setShipText] = useState(() => localStorage.getItem(SHIP_NAME_KEY) ?? '');
  const [ship, setShip] = useState<ContractShipHit | null>(() => {
    const id = Number(localStorage.getItem(SHIP_ID_KEY));
    const name = localStorage.getItem(SHIP_NAME_KEY);
    const groupName = localStorage.getItem(SHIP_GROUP_KEY);
    return Number.isFinite(id) && id > 0 && name && groupName ? { id, name, groupName } : null;
  });
  const [shipHits, setShipHits] = useState<ContractShipHit[]>([]);
  const [originText, setOriginText] = useState(() => localStorage.getItem(ORIGIN_NAME_KEY) ?? '');
  const [origin, setOrigin] = useState<SystemHit | null>(() => {
    const id = Number(localStorage.getItem(ORIGIN_ID_KEY));
    const name = localStorage.getItem(ORIGIN_NAME_KEY);
    return Number.isFinite(id) && id > 0 && name ? { id, name } : null;
  });
  const [systemHits, setSystemHits] = useState<SystemHit[]>([]);
  const [radius, setRadius] = useState(() => Number(localStorage.getItem(RADIUS_KEY) ?? 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ContractSearchResponse | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    searchContractShips(shipText, ctrl.signal).then(setShipHits).catch(() => {});
    return () => ctrl.abort();
  }, [shipText]);

  useEffect(() => {
    const ctrl = new AbortController();
    searchSystems(originText, ctrl.signal).then(setSystemHits).catch(() => {});
    return () => ctrl.abort();
  }, [originText]);

  useEffect(() => {
    if (!ship) return;
    localStorage.setItem(SHIP_ID_KEY, String(ship.id));
    localStorage.setItem(SHIP_NAME_KEY, ship.name);
    localStorage.setItem(SHIP_GROUP_KEY, ship.groupName);
  }, [ship]);

  useEffect(() => {
    if (!origin) return;
    localStorage.setItem(ORIGIN_ID_KEY, String(origin.id));
    localStorage.setItem(ORIGIN_NAME_KEY, origin.name);
  }, [origin]);

  useEffect(() => {
    localStorage.setItem(RADIUS_KEY, String(radius));
  }, [radius]);

  const canSearch = ship != null && origin != null && radius >= 1 && radius <= 100;

  const doSearch = async () => {
    if (!ship || !origin) return;
    setBusy(true);
    setError(null);
    const result = await searchContracts({ shipId: ship.id, originSystemId: origin.id, radius });
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setResponse(result);
  };

  const summary = useMemo(() => {
    if (!response) return null;
    const known = response.results.filter(r => r.jumps != null).length;
    return `${response.results.length} contracts · ${known} with jump distance · ${response.regionsScanned.length} regions`;
  }, [response]);

  return (
    <main className="rows-wrap contracts-view">
      <section className="ct-search">
        <div className="ct-field">
          <label>Ship</label>
          <input
            value={shipText}
            onChange={e => { setShipText(e.target.value); setShip(null); }}
          />
          {shipHits.length > 0 && !ship && (
            <div className="ct-suggest">
              {shipHits.map(hit => (
                <button key={hit.id} onClick={() => { setShip(hit); setShipText(hit.name); setShipHits([]); }}>
                  <span>{hit.name}</span>
                  <small>{hit.groupName}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ct-field">
          <label>Origin</label>
          <input
            value={originText}
            onChange={e => { setOriginText(e.target.value); setOrigin(null); }}
          />
          {systemHits.length > 0 && !origin && (
            <div className="ct-suggest">
              {systemHits.map(hit => (
                <button key={hit.id} onClick={() => { setOrigin(hit); setOriginText(hit.name); setSystemHits([]); }}>
                  <span>{hit.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ct-field ct-radius">
          <label>Jumps</label>
          <input
            type="number"
            min={1}
            max={100}
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
          />
        </div>

        <button className="primary ct-search-btn" disabled={!canSearch || busy} onClick={doSearch}>
          {busy ? 'Searching...' : 'Search'}
        </button>
      </section>

      {error && <div className="ct-error">{error}</div>}

      {!response && !busy && !error && (
        <div className="empty">Pick a ship and origin system to search public contracts.</div>
      )}

      {response && (
        <>
          <section className="ct-summary">
            <strong>{response.ship.name}</strong>
            <span>{response.origin.name} · {response.radius} jumps</span>
            <span>{summary}</span>
            <span>Updated {new Date(response.fetchedAt).toLocaleTimeString()}</span>
          </section>

          {response.warnings.length > 0 && (
            <div className="ct-warnings">
              {response.warnings.map(w => (
                <span key={w.code}>{w.message}{w.count ? ` (${w.count})` : ''}</span>
              ))}
            </div>
          )}

          {response.results.length === 0 ? (
            <div className="empty">No matching public contracts found.</div>
          ) : (
            <ContractResultsTable rows={response.results} />
          )}
        </>
      )}
    </main>
  );
}

function ContractResultsTable({ rows }: { rows: ContractSearchResult[] }) {
  return (
    <table className="ct-table">
      <thead>
        <tr>
          <th>Ship</th>
          <th>Type</th>
          <th className="num">Price</th>
          <th className="num">Qty</th>
          <th>Location</th>
          <th className="num">Jumps</th>
          <th>Expires</th>
          <th>Title</th>
          <th className="num">Contract</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.contractId}>
            <td>{row.shipName}</td>
            <td>{row.type === 'item_exchange' ? 'Item exchange' : 'Auction'}</td>
            <td className="num">{formatIsk(row.effectivePrice)}</td>
            <td className="num">{row.quantity.toLocaleString()}</td>
            <td>
              <div>{row.locationName}</div>
              <small>{row.systemName ?? 'Unknown system'} · {row.regionName}</small>
            </td>
            <td className="num">{row.jumps ?? 'unknown'}</td>
            <td>{formatExpiry(row.dateExpired)}</td>
            <td>{row.title || '-'}</td>
            <td className="num">{row.contractId}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatIsk(n: number | null): string {
  if (n == null) return '-';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
}

function formatExpiry(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const hours = Math.max(0, Math.round((ms - Date.now()) / 36e5));
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
```

- [ ] **Step 3: Add top-level view wiring**

Modify `web/src/App.tsx`:

```ts
import { ContractsView } from './components/ContractsView.tsx';
```

Change the `View` union:

```ts
type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts';
```

Render the new tab:

```tsx
{view === 'contracts' && <ContractsView />}
```

- [ ] **Step 4: Add sidebar nav and help text**

Modify `web/src/components/ControlPanel.tsx`:

```ts
type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts';
```

Use the `View` type in `Props`:

```ts
interface Props {
  chars: CharacterStatus[];
  selection: Set<number>;
  onRefresh: () => void;
  view: View;
  setView: (v: View) => void;
}
```

Change the nav wrapper to `view-nav-7` and add:

```tsx
<button
  className={`nav-btn${view === 'contracts' ? ' active' : ''}`}
  onClick={() => setView('contracts')}
>Contracts</button>
```

Add the Contracts sidebar hint near the Market/Industry hints:

```tsx
{view === 'contracts' && (
  <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.4 }}>
    Search public ship contracts around an origin system. V1 uses public item-exchange and auction contracts only; player-structure locations may show as unknown.
  </div>
)}
```

- [ ] **Step 5: Add CSS for Contracts view**

Append to `web/src/styles.css`:

```css
/* Contracts */
.contracts-view { padding: 12px 16px; gap: 12px; display: flex; flex-direction: column; }
.ct-search {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(180px, 1.2fr) 96px auto;
  gap: 10px;
  align-items: end;
}
.ct-field { position: relative; display: flex; flex-direction: column; gap: 5px; }
.ct-field label { font-size: 12px; color: var(--dim); }
.ct-field input {
  background: #101620;
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 4px;
  padding: 8px 10px;
}
.ct-radius input { text-align: right; font-variant-numeric: tabular-nums; }
.ct-search-btn { min-height: 36px; }
.ct-suggest {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 5;
  background: #0f141d;
  border: 1px solid var(--line);
  border-radius: 4px;
  margin-top: 3px;
  overflow: hidden;
  box-shadow: 0 8px 20px rgba(0,0,0,0.35);
}
.ct-suggest button {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 9px;
  text-align: left;
}
.ct-suggest button:hover { background: rgba(83, 185, 255, 0.12); }
.ct-suggest small { color: var(--dim); }
.ct-summary,
.ct-warnings {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  color: var(--dim);
  font-size: 13px;
}
.ct-summary strong { color: var(--text); }
.ct-warnings { color: var(--amber); }
.ct-error {
  border: 1px solid rgba(255, 107, 107, 0.45);
  color: var(--red);
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(255, 107, 107, 0.08);
}
.ct-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.ct-table th,
.ct-table td {
  border-bottom: 1px solid var(--line);
  padding: 8px 8px;
  vertical-align: top;
}
.ct-table th {
  color: var(--dim);
  font-weight: 600;
  text-align: left;
}
.ct-table .num { text-align: right; }
.ct-table small { color: var(--dim); display: block; margin-top: 2px; }

@media (max-width: 900px) {
  .ct-search { grid-template-columns: 1fr 1fr; }
  .ct-search-btn { grid-column: span 2; }
}
```

If `.view-nav-6` has fixed layout assumptions, extend the existing selector group:

```css
.view-nav-7 { grid-template-columns: 1fr; }
.view-nav-7 .nav-btn { padding: 8px 12px; text-align: left; }
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Build frontend**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit UI**

```bash
git add web/src/api.ts web/src/components/ContractsView.tsx web/src/App.tsx web/src/components/ControlPanel.tsx web/src/styles.css
git commit -m "feat: add contracts tab"
```

---

### Task 6: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed backend and frontend work.
- Produces: README documentation for the Contracts view.

- [ ] **Step 1: Update README view list**

In `README.md`, update the sentence that says the dashboard has six top-level views to seven top-level views.

Add this bullet after Market:

```md
- **Contracts** — public ship-contract search: pick a hull and origin system, scan item-exchange and auction contracts within a default 30-jump radius, and sort results by jumps then price.
```

- [ ] **Step 2: Add Contracts section**

Add this section near the existing Market/Industry sections:

```md
## Contracts view

The Contracts tab searches public ESI contracts for a selected ship hull around an origin system.

1. Pick a ship from autocomplete. The list uses the bundled SDE ship map.
2. Pick an origin system from the existing system autocomplete.
3. Keep the default `30` jump radius or enter a value from `1` to `100`.
4. Search public item-exchange and auction contracts.

The server computes jump distance locally from the SDE stargate graph, then scans public contract regions touched by the radius. Results are sorted by jump count and effective price. Player-structure contracts can appear with unknown distance when the public contract data does not provide a resolvable system.

V1 does not create, accept, bid on, or delete contracts. It does not read private character or corporation contracts.
```

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Start local dev server**

Run: `npm run dev`

Expected: server starts on `http://127.0.0.1:3100` and Vite starts on `http://localhost:5173`.

- [ ] **Step 5: Manual browser verification**

Open `http://localhost:5173`.

Manual checks:

- Contracts appears in the sidebar.
- Selecting Contracts shows ship, origin, radius, and Search controls.
- Ship autocomplete returns `Barghest` for `bar`.
- System autocomplete returns `Jita` for `jit`.
- Search `Barghest` from `Jita` with radius `30`.
- Loading state appears while ESI requests run.
- Results, no-results, partial-warning, or clear error state appears.
- Switch to another tab and back; entered values persist.
- Reload the page; entered values persist.

- [ ] **Step 6: Stop local dev server**

Stop the `npm run dev` process with Ctrl-C in its terminal session.

- [ ] **Step 7: Commit docs and verification updates**

```bash
git add README.md
git commit -m "docs: document contracts tab"
```

---

## Self-Review Checklist

- Spec coverage: Tasks cover ship autocomplete, origin system usage, 30-jump default, local map BFS, region scanning, public contract ESI calls, item filtering, unknown-location handling, result sorting, warnings, UI state persistence, and README docs.
- Incomplete-marker scan: This plan contains no unresolved implementation steps.
- Type consistency: `ContractSearchResult`, `ContractSearchResponse`, `ContractShipHit`, and route parameter names are consistent across backend, API helpers, and UI.
- Scope check: Background indexing, private contracts, corp contracts, bid details, and contract actions remain outside v1.
