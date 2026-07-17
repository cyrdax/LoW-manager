# Assets View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private cached Assets tab that summarizes and drills into character-owned EVE assets across all authenticated pilots for the current account.

**Architecture:** Add an assets domain layer for categorization, tree construction, aggregation, and valuation; persist processed per-pilot snapshots in Postgres; expose private `/api/assets` routes; render a new React Assets view between Fits and Market. Refreshes are manual and cache-backed, with per-pilot and refresh-all flows.

**Tech Stack:** TypeScript, Fastify, PostgreSQL via existing migration runner, React, Vite, EVE ESI, existing market pricing helpers, Node test runner.

## Global Constraints

- Asset data is private per account and must only include pilots owned by the logged-in user.
- V1 includes character-owned assets only; corporation assets are out of scope.
- Data refresh is manual only; no automatic ESI refresh on page load.
- Snapshots older than 24 hours are `Stale` but still displayed.
- Add `esi-assets.read_assets.v1` to future EVE SSO authorization.
- Existing pilots without `esi-assets.read_assets.v1` must show `Missing asset scope`.
- Default valuation hub is Jita.
- Top dashboard uses broad built-in categories, not user-editable categories.
- The sidebar order becomes `Pilots`, `Fleet`, `Fits`, `Assets`, `Market`, `Contracts`, `Industry`, `Planets`.
- Run `npm test` before final implementation commit.

---

## File Structure

- Create `src/assets/types.ts`: shared server-side asset domain types and constants.
- Create `src/assets/categories.ts`: map EVE item metadata into v1 dashboard categories.
- Create `src/assets/tree.ts`: build nested trees and aggregate pilot/location/category totals.
- Create `src/assets/store.ts`: SQLite test store and Postgres snapshot store.
- Create `src/assets/refresh.ts`: ESI refresh orchestration, location resolution, pricing, and snapshot generation.
- Create `src/esi/assets.ts`: typed wrapper for `GET /characters/{character_id}/assets/`.
- Create `src/routes/assets.ts`: private Assets API routes.
- Create tests under `src/assets/*.test.ts` and `src/routes/assets.test.ts`.
- Modify `src/fits/metadata.ts`: expose item metadata lookup by type ID.
- Modify `src/auth/scopes.ts`: add `esi-assets.read_assets.v1`.
- Modify `src/server.ts`: register assets store and routes.
- Modify `src/db/migrations/0001_multi_tenant_foundation.sql`: add asset snapshot tables to the existing production foundation migration.
- Modify `web/src/api.ts`: add assets response types and API functions.
- Create `web/src/components/AssetsView.tsx`: dashboard, controls, expandable tree.
- Modify `web/src/App.tsx`: include `assets` view.
- Modify `web/src/components/ControlPanel.tsx`: add sidebar button between Fits and Market.
- Modify `web/src/styles.css`: assets dashboard/tree styling.
- Create `src/assets/assets-view.test.ts`: frontend source-structure regression tests.

---

### Task 1: Asset Domain Types, Categories, And Tree Aggregates

**Files:**
- Create: `src/assets/types.ts`
- Create: `src/assets/categories.ts`
- Create: `src/assets/tree.ts`
- Test: `src/assets/categories.test.ts`
- Test: `src/assets/tree.test.ts`
- Modify: `src/fits/metadata.ts`
- Test: `src/fits/metadata.test.ts`

**Interfaces:**
- Produces: `ASSET_STALE_MS`, `AssetCategoryKey`, `AssetItemMetadata`, `AssetSnapshot`, `AssetPilotSummary`, `AssetLocationNode`, `AssetTreeNode`, `categorizeAssetItem(meta)`, `buildAssetTree(input)`, `aggregateAssetSnapshot(input)`, `resolveItemByTypeId(typeId)`.
- Consumes later: Tasks 2, 3, 4, and 5 use these exact domain types.

- [ ] **Step 1: Write category tests**

Add `src/assets/categories.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { categorizeAssetItem } from './categories.ts';

test('categorizeAssetItem maps broad v1 asset dashboard groups', () => {
  assert.equal(categorizeAssetItem({ typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship' }).primary, 'frigates');
  assert.equal(categorizeAssetItem({ typeId: 24688, name: 'Rokh', groupId: 27, groupName: 'Battleship', categoryId: 6, categoryName: 'Ship' }).primary, 'battleships');
  assert.equal(categorizeAssetItem({ typeId: 19722, name: 'Naglfar', groupId: 485, groupName: 'Dreadnought', categoryId: 6, categoryName: 'Ship' }).primary, 'capitals');
  assert.equal(categorizeAssetItem({ typeId: 2048, name: 'Damage Control II', groupId: 60, groupName: 'Damage Control', categoryId: 7, categoryName: 'Module' }).primary, 'modules');
  assert.equal(categorizeAssetItem({ typeId: 31177, name: 'Small Gravity Capacitor Upgrade II', groupId: 773, groupName: 'Rig Scanning', categoryId: 7, categoryName: 'Module' }).primary, 'scanning');
  assert.equal(categorizeAssetItem({ typeId: 9942, name: 'Memory Augmentation - Basic', groupId: 300, groupName: 'Cyberimplant', categoryId: 20, categoryName: 'Implant' }).primary, 'implants');
  assert.equal(categorizeAssetItem({ typeId: 34, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' }).primary, 'minerals');
  assert.equal(categorizeAssetItem({ typeId: 999999, name: 'Mystery Thing', groupId: 0, groupName: 'Mystery', categoryId: 0, categoryName: 'Mystery' }).primary, 'other');
});

test('ship subcategories roll up to ships without changing primary category', () => {
  const category = categorizeAssetItem({ typeId: 587, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship' });
  assert.equal(category.primary, 'frigates');
  assert.deepEqual(category.rollups, ['ships']);
});
```

- [ ] **Step 2: Run category tests to verify they fail**

Run: `node --import tsx --test src/assets/categories.test.ts`

Expected: FAIL because `src/assets/categories.ts` does not exist.

- [ ] **Step 3: Implement asset domain types**

Create `src/assets/types.ts`:

```ts
export const ASSET_STALE_MS = 24 * 60 * 60 * 1000;

export type AssetCategoryKey =
  | 'ships'
  | 'frigates'
  | 'cruisers'
  | 'battleships'
  | 'capitals'
  | 'mining-ships'
  | 'modules'
  | 'armor-modules'
  | 'shield-modules'
  | 'scanning'
  | 'cpu-powergrid'
  | 'weapon-upgrades'
  | 'implants'
  | 'drones-fighters'
  | 'ammo'
  | 'materials'
  | 'minerals'
  | 'pi'
  | 'blueprints'
  | 'other';

export interface AssetCategoryInfo {
  key: AssetCategoryKey;
  label: string;
  primary: AssetCategoryKey;
  rollups: AssetCategoryKey[];
}

export interface AssetItemMetadata {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
}

export type AssetPricingStatus = 'priced' | 'partial' | 'unpriced';
export type AssetLocationStatus = 'resolved' | 'unresolved';
export type AssetPilotStatus = 'Ready' | 'Refreshing' | 'Needs refresh' | 'Stale' | 'Missing asset scope' | 'Needs re-auth' | 'Error';

export interface AssetValueSummary {
  itemCount: number;
  stackCount: number;
  pricedValue: number;
  totalValue: number;
  unpricedStacks: number;
}

export interface AssetTreeNode extends AssetValueSummary {
  itemId: number;
  typeId: number;
  name: string;
  category: AssetCategoryKey;
  categoryLabel: string;
  quantity: number;
  unitValue: number | null;
  stackValue: number;
  pricingStatus: AssetPricingStatus;
  singleton: boolean;
  parentItemId: number | null;
  locationId: number;
  locationFlag: string;
  locationType: string;
  children: AssetTreeNode[];
}

export interface AssetLocationNode extends AssetValueSummary {
  locationId: number;
  name: string;
  type: string;
  status: AssetLocationStatus;
  rawLocationId: number;
  assets: AssetTreeNode[];
}

export interface AssetCategorySummary extends AssetValueSummary {
  key: AssetCategoryKey;
  label: string;
}

export interface AssetPilotSummary extends AssetValueSummary {
  characterId: number;
  characterName: string;
  status: AssetPilotStatus;
  locationCount: number;
  lastRefreshedAt: number | null;
  error: string | null;
}

export interface AssetSnapshot {
  pilot: AssetPilotSummary;
  locations: AssetLocationNode[];
  categories: AssetCategorySummary[];
}

export interface RawAssetInput {
  itemId: number;
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  quantity: number;
  singleton: boolean;
  locationId: number;
  locationFlag: string;
  locationType: string;
  unitValue: number | null;
  pricingStatus: AssetPricingStatus;
}

export interface RawAssetLocationInput {
  locationId: number;
  name: string;
  type: string;
  status: AssetLocationStatus;
}
```

- [ ] **Step 4: Implement category mapping**

Create `src/assets/categories.ts`:

```ts
import type { AssetCategoryInfo, AssetCategoryKey, AssetItemMetadata } from './types.ts';

export const ASSET_CATEGORY_LABELS: Record<AssetCategoryKey, string> = {
  ships: 'Ships',
  frigates: 'Frigates',
  cruisers: 'Cruisers',
  battleships: 'Battleships',
  capitals: 'Capitals',
  'mining-ships': 'Mining Ships',
  modules: 'Modules',
  'armor-modules': 'Armor Modules',
  'shield-modules': 'Shield Modules',
  scanning: 'Scanning Equipment',
  'cpu-powergrid': 'CPU/Powergrid Upgrades',
  'weapon-upgrades': 'Weapon Upgrades',
  implants: 'Implants',
  'drones-fighters': 'Drones/Fighters',
  ammo: 'Ammo',
  materials: 'Materials',
  minerals: 'Minerals',
  pi: 'PI',
  blueprints: 'Blueprints',
  other: 'Other',
};

const CAPITAL_GROUPS = ['carrier', 'dreadnought', 'force auxiliary', 'supercarrier', 'titan', 'capital industrial ship'];
const MINING_GROUPS = ['mining barge', 'exhumer', 'industrial command ship'];
const ARMOR_TERMS = ['armor', 'energized', 'plating', 'repairer'];
const SHIELD_TERMS = ['shield', 'booster', 'hardener', 'extender'];
const SCANNING_TERMS = ['scan', 'scanner', 'probe', 'analyzer', 'hacking', 'archaeology'];
const CPU_POWERGRID_TERMS = ['cpu', 'powergrid', 'power diagnostic', 'reactor control', 'micro auxiliary power core'];
const WEAPON_UPGRADE_TERMS = ['gyrostabilizer', 'heat sink', 'magnetic field stabilizer', 'ballistic control', 'tracking enhancer', 'damage amplifier'];

export function categorizeAssetItem(meta: AssetItemMetadata): AssetCategoryInfo {
  const category = meta.categoryName.toLowerCase();
  const group = meta.groupName.toLowerCase();
  const name = meta.name.toLowerCase();

  const primary = primaryCategory(category, group, name);
  const rollups: AssetCategoryKey[] = [];
  if (category === 'ship' && primary !== 'ships') rollups.push('ships');
  if (category === 'module' && primary !== 'modules') rollups.push('modules');
  if ((category === 'material' || category === 'commodity') && primary !== 'materials') rollups.push('materials');

  return {
    key: primary,
    label: ASSET_CATEGORY_LABELS[primary],
    primary,
    rollups,
  };
}

function primaryCategory(category: string, group: string, name: string): AssetCategoryKey {
  if (category === 'ship') {
    if (group.includes('frigate')) return 'frigates';
    if (group.includes('cruiser')) return 'cruisers';
    if (group.includes('battlecruiser')) return 'cruisers';
    if (group.includes('battleship')) return 'battleships';
    if (CAPITAL_GROUPS.some(term => group.includes(term))) return 'capitals';
    if (MINING_GROUPS.some(term => group.includes(term))) return 'mining-ships';
    return 'ships';
  }
  if (category === 'implant') return 'implants';
  if (category === 'drone' || category === 'fighter') return 'drones-fighters';
  if (category === 'charge') return 'ammo';
  if (category === 'blueprint') return 'blueprints';
  if (group.includes('mineral')) return 'minerals';
  if (group.includes('planetary') || group.includes('commodity')) return 'pi';
  if (category === 'material') return 'materials';
  if (category === 'module') {
    if (SCANNING_TERMS.some(term => group.includes(term) || name.includes(term))) return 'scanning';
    if (CPU_POWERGRID_TERMS.some(term => group.includes(term) || name.includes(term))) return 'cpu-powergrid';
    if (WEAPON_UPGRADE_TERMS.some(term => group.includes(term) || name.includes(term))) return 'weapon-upgrades';
    if (ARMOR_TERMS.some(term => group.includes(term) || name.includes(term))) return 'armor-modules';
    if (SHIELD_TERMS.some(term => group.includes(term) || name.includes(term))) return 'shield-modules';
    return 'modules';
  }
  return 'other';
}
```

- [ ] **Step 5: Extend fit metadata lookup by type ID**

Modify `src/fits/metadata.ts` so `MetadataCache` tracks items by ID and exports `resolveItemByTypeId`:

```ts
interface MetadataCache {
  shipsByName: Map<string, FitShip>;
  shipsById: Map<number, FitShip>;
  itemsByName: Map<string, FitItem>;
  itemsById: Map<number, FitItem>;
  layoutsById: Map<number, Partial<Record<SlotKey, number>>>;
}

export function resolveItemByTypeId(typeId: number): FitItem | null {
  return getCache().itemsById.get(typeId) ?? null;
}
```

When constructing the cache, set `itemsById` everywhere an item is added:

```ts
const itemsById = new Map<number, FitItem>();
const item: FitItem = {
  typeId,
  name: itemData.name,
  groupId: itemData.groupId,
  groupName: itemData.groupName,
  categoryId: itemData.categoryId,
  categoryName: itemData.categoryName,
};
itemsByName.set(normalizeName(item.name), item);
itemsById.set(typeId, item);
```

Change `supplementItemsFromFuzzwork` to accept both maps:

```ts
function supplementItemsFromFuzzwork(itemsByName: Map<string, FitItem>, itemsById: Map<number, FitItem>): void {
  // existing CSV parsing remains; when creating a FitItem, set both maps.
}
```

- [ ] **Step 6: Add metadata test for type ID lookup**

Append to `src/fits/metadata.test.ts`:

```ts
import { resolveItemByTypeId } from './metadata.ts';

test('resolves item metadata by type id for asset imports', () => {
  const tritanium = resolveItemByTypeId(34);
  assert.equal(tritanium?.name, 'Tritanium');
  assert.equal(tritanium?.groupName, 'Mineral');
});
```

- [ ] **Step 7: Write tree aggregate tests**

Create `src/assets/tree.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssetTree } from './tree.ts';
import type { RawAssetInput, RawAssetLocationInput } from './types.ts';

const locations: RawAssetLocationInput[] = [
  { locationId: 60003760, name: 'Jita IV - Moon 4', type: 'station', status: 'resolved' },
];

test('buildAssetTree nests contained assets and rolls values up without duplicating stack rows', () => {
  const assets: RawAssetInput[] = [
    {
      itemId: 1,
      typeId: 587,
      name: 'Rifter',
      groupId: 25,
      groupName: 'Frigate',
      categoryId: 6,
      categoryName: 'Ship',
      quantity: 1,
      singleton: true,
      locationId: 60003760,
      locationFlag: 'Hangar',
      locationType: 'station',
      unitValue: 1_000_000,
      pricingStatus: 'priced',
    },
    {
      itemId: 2,
      typeId: 34,
      name: 'Tritanium',
      groupId: 18,
      groupName: 'Mineral',
      categoryId: 4,
      categoryName: 'Material',
      quantity: 100,
      singleton: false,
      locationId: 1,
      locationFlag: 'Cargo',
      locationType: 'item',
      unitValue: 5,
      pricingStatus: 'priced',
    },
  ];

  const tree = buildAssetTree({
    characterId: 123,
    characterName: 'Asset Pilot',
    lastRefreshedAt: 1_700_000_000_000,
    status: 'Ready',
    error: null,
    locations,
    assets,
  });

  assert.equal(tree.pilot.totalValue, 1_000_500);
  assert.equal(tree.pilot.stackCount, 2);
  assert.equal(tree.locations[0].totalValue, 1_000_500);
  assert.equal(tree.locations[0].assets[0].children[0].name, 'Tritanium');
  assert.equal(tree.categories.find(c => c.key === 'frigates')?.totalValue, 1_000_000);
  assert.equal(tree.categories.find(c => c.key === 'ships')?.totalValue, 1_000_000);
  assert.equal(tree.categories.find(c => c.key === 'minerals')?.totalValue, 500);
});

test('buildAssetTree tracks unpriced stacks in aggregates', () => {
  const tree = buildAssetTree({
    characterId: 123,
    characterName: 'Asset Pilot',
    lastRefreshedAt: null,
    status: 'Needs refresh',
    error: null,
    locations,
    assets: [{
      itemId: 3,
      typeId: 999999,
      name: 'Mystery Thing',
      groupId: 0,
      groupName: 'Mystery',
      categoryId: 0,
      categoryName: 'Mystery',
      quantity: 1,
      singleton: false,
      locationId: 60003760,
      locationFlag: 'Hangar',
      locationType: 'station',
      unitValue: null,
      pricingStatus: 'unpriced',
    }],
  });

  assert.equal(tree.pilot.totalValue, 0);
  assert.equal(tree.pilot.unpricedStacks, 1);
  assert.equal(tree.categories.find(c => c.key === 'other')?.unpricedStacks, 1);
});
```

- [ ] **Step 8: Run tree tests to verify they fail**

Run: `node --import tsx --test src/assets/tree.test.ts`

Expected: FAIL because `src/assets/tree.ts` does not exist.

- [ ] **Step 9: Implement tree construction**

Create `src/assets/tree.ts`:

```ts
import { ASSET_CATEGORY_LABELS, categorizeAssetItem } from './categories.ts';
import type {
  AssetCategoryKey,
  AssetCategorySummary,
  AssetLocationNode,
  AssetSnapshot,
  AssetTreeNode,
  AssetValueSummary,
  RawAssetInput,
  RawAssetLocationInput,
} from './types.ts';

interface BuildInput {
  characterId: number;
  characterName: string;
  status: AssetSnapshot['pilot']['status'];
  error: string | null;
  lastRefreshedAt: number | null;
  locations: RawAssetLocationInput[];
  assets: RawAssetInput[];
}

export function buildAssetTree(input: BuildInput): AssetSnapshot {
  const byItemId = new Map<number, AssetTreeNode>();
  const rootsByLocation = new Map<number, AssetTreeNode[]>();

  for (const raw of input.assets) {
    const category = categorizeAssetItem(raw);
    const stackValue = raw.unitValue == null ? 0 : raw.unitValue * raw.quantity;
    const node: AssetTreeNode = {
      itemId: raw.itemId,
      typeId: raw.typeId,
      name: raw.name,
      category: category.primary,
      categoryLabel: category.label,
      quantity: raw.quantity,
      unitValue: raw.unitValue,
      stackValue,
      pricingStatus: raw.pricingStatus,
      singleton: raw.singleton,
      parentItemId: raw.locationType === 'item' ? raw.locationId : null,
      locationId: raw.locationId,
      locationFlag: raw.locationFlag,
      locationType: raw.locationType,
      children: [],
      itemCount: raw.quantity,
      stackCount: 1,
      pricedValue: stackValue,
      totalValue: stackValue,
      unpricedStacks: raw.pricingStatus === 'unpriced' ? 1 : 0,
    };
    byItemId.set(node.itemId, node);
  }

  for (const node of byItemId.values()) {
    if (node.parentItemId != null) {
      const parent = byItemId.get(node.parentItemId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    const roots = rootsByLocation.get(node.locationId) ?? [];
    roots.push(node);
    rootsByLocation.set(node.locationId, roots);
  }

  for (const node of byItemId.values()) recalculateNode(node);

  const locationInputs = new Map(input.locations.map(location => [location.locationId, location]));
  for (const locationId of rootsByLocation.keys()) {
    if (!locationInputs.has(locationId)) {
      locationInputs.set(locationId, {
        locationId,
        name: `Unknown location ${locationId}`,
        type: 'unknown',
        status: 'unresolved',
      });
    }
  }

  const locations: AssetLocationNode[] = [...locationInputs.values()]
    .map(location => {
      const assets = rootsByLocation.get(location.locationId) ?? [];
      const summary = summarize(assets);
      return {
        locationId: location.locationId,
        rawLocationId: location.locationId,
        name: location.name,
        type: location.type,
        status: location.status,
        assets,
        ...summary,
      };
    })
    .filter(location => location.assets.length > 0)
    .sort((a, b) => b.totalValue - a.totalValue || a.name.localeCompare(b.name));

  const categories = summarizeCategories(input.assets);
  const pilotSummary = summarize(locations);

  return {
    pilot: {
      characterId: input.characterId,
      characterName: input.characterName,
      status: input.status,
      locationCount: locations.length,
      lastRefreshedAt: input.lastRefreshedAt,
      error: input.error,
      ...pilotSummary,
    },
    locations,
    categories,
  };
}

function recalculateNode(node: AssetTreeNode): AssetValueSummary {
  const children = summarize(node.children);
  node.itemCount = node.quantity + children.itemCount;
  node.stackCount = 1 + children.stackCount;
  node.pricedValue = node.stackValue + children.pricedValue;
  node.totalValue = node.stackValue + children.totalValue;
  node.unpricedStacks = (node.pricingStatus === 'unpriced' ? 1 : 0) + children.unpricedStacks;
  node.children.sort((a, b) => b.totalValue - a.totalValue || a.name.localeCompare(b.name));
  return node;
}

function summarize(rows: AssetValueSummary[]): AssetValueSummary {
  return rows.reduce<AssetValueSummary>((acc, row) => ({
    itemCount: acc.itemCount + row.itemCount,
    stackCount: acc.stackCount + row.stackCount,
    pricedValue: acc.pricedValue + row.pricedValue,
    totalValue: acc.totalValue + row.totalValue,
    unpricedStacks: acc.unpricedStacks + row.unpricedStacks,
  }), { itemCount: 0, stackCount: 0, pricedValue: 0, totalValue: 0, unpricedStacks: 0 });
}

function summarizeCategories(assets: RawAssetInput[]): AssetCategorySummary[] {
  const byCategory = new Map<AssetCategoryKey, AssetCategorySummary>();

  for (const raw of assets) {
    const category = categorizeAssetItem(raw);
    const value = raw.unitValue == null ? 0 : raw.unitValue * raw.quantity;
    const unpriced = raw.pricingStatus === 'unpriced' ? 1 : 0;
    for (const key of [category.primary, ...category.rollups]) {
      const row = byCategory.get(key) ?? {
        key,
        label: ASSET_CATEGORY_LABELS[key],
        itemCount: 0,
        stackCount: 0,
        pricedValue: 0,
        totalValue: 0,
        unpricedStacks: 0,
      };
      row.itemCount += raw.quantity;
      row.stackCount += 1;
      row.pricedValue += value;
      row.totalValue += value;
      row.unpricedStacks += unpriced;
      byCategory.set(key, row);
    }
  }

  return [...byCategory.values()].sort((a, b) => b.totalValue - a.totalValue || a.label.localeCompare(b.label));
}
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
node --import tsx --test src/assets/categories.test.ts src/assets/tree.test.ts src/fits/metadata.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add src/assets/types.ts src/assets/categories.ts src/assets/tree.ts src/assets/categories.test.ts src/assets/tree.test.ts src/fits/metadata.ts src/fits/metadata.test.ts
git commit -m "feat: add asset categorization and tree aggregates"
```

---

### Task 2: Asset Snapshot Persistence

**Files:**
- Create: `src/assets/store.ts`
- Test: `src/assets/store.test.ts`
- Modify: `src/db/migrations/0001_multi_tenant_foundation.sql`

**Interfaces:**
- Consumes: `AssetSnapshot`, `AssetPilotStatus`.
- Produces: `AssetSnapshotStore`, `createSqliteAssetSnapshotStore(database)`, `createPostgresAssetSnapshotStore(client)`, `migrateAssetSnapshotsDb(database)`.

- [ ] **Step 1: Write store tests**

Create `src/assets/store.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSqliteAssetSnapshotStore, migrateAssetSnapshotsDb } from './store.ts';
import type { AssetSnapshot } from './types.ts';

function sampleSnapshot(characterId = 123): AssetSnapshot {
  return {
    pilot: {
      characterId,
      characterName: 'Asset Pilot',
      status: 'Ready',
      locationCount: 1,
      lastRefreshedAt: 1_700_000_000_000,
      error: null,
      itemCount: 10,
      stackCount: 2,
      pricedValue: 1_000_500,
      totalValue: 1_000_500,
      unpricedStacks: 0,
    },
    locations: [{
      locationId: 60003760,
      rawLocationId: 60003760,
      name: 'Jita IV - Moon 4',
      type: 'station',
      status: 'resolved',
      itemCount: 10,
      stackCount: 2,
      pricedValue: 1_000_500,
      totalValue: 1_000_500,
      unpricedStacks: 0,
      assets: [],
    }],
    categories: [{
      key: 'ships',
      label: 'Ships',
      itemCount: 1,
      stackCount: 1,
      pricedValue: 1_000_000,
      totalValue: 1_000_000,
      unpricedStacks: 0,
    }],
  };
}

test('asset snapshot store replaces and lists user-scoped snapshots', () => {
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  const store = createSqliteAssetSnapshotStore(db);

  store.replaceSnapshot('user-a', sampleSnapshot(123));
  store.replaceSnapshot('user-b', sampleSnapshot(456));
  store.replaceSnapshot('user-a', { ...sampleSnapshot(123), pilot: { ...sampleSnapshot(123).pilot, totalValue: 2_000_000 } });

  const userA = store.listSnapshots('user-a', 1_700_000_000_100);
  assert.equal(userA.length, 1);
  assert.equal(userA[0].pilot.characterId, 123);
  assert.equal(userA[0].pilot.totalValue, 2_000_000);

  const userB = store.listSnapshots('user-b', 1_700_000_000_100);
  assert.equal(userB.length, 1);
  assert.equal(userB[0].pilot.characterId, 456);
});

test('asset snapshot store marks stale snapshots older than 24 hours', () => {
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  const store = createSqliteAssetSnapshotStore(db);
  store.replaceSnapshot('user-a', sampleSnapshot(123));

  const stale = store.listSnapshots('user-a', 1_700_000_000_000 + 24 * 60 * 60 * 1000 + 1)[0];
  assert.equal(stale.pilot.status, 'Stale');
});

test('asset snapshot store records status without asset data', () => {
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  const store = createSqliteAssetSnapshotStore(db);

  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Missing asset scope', 'Re-auth required', 1_700_000_000_000);
  const snapshots = store.listSnapshots('user-a', 1_700_000_000_000);

  assert.equal(snapshots[0].pilot.status, 'Missing asset scope');
  assert.equal(snapshots[0].pilot.error, 'Re-auth required');
  assert.equal(snapshots[0].locations.length, 0);
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run: `node --import tsx --test src/assets/store.test.ts`

Expected: FAIL because `src/assets/store.ts` does not exist.

- [ ] **Step 3: Implement store**

Create `src/assets/store.ts`:

```ts
import type Database from 'better-sqlite3';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';
import { ASSET_STALE_MS, type AssetPilotStatus, type AssetSnapshot } from './types.ts';

type SqliteDatabase = Database.Database;

export interface AssetSnapshotStore {
  listSnapshots(userId: string, now?: number): Promise<AssetSnapshot[]> | AssetSnapshot[];
  replaceSnapshot(userId: string, snapshot: AssetSnapshot): Promise<void> | void;
  recordPilotStatus(
    userId: string,
    characterId: number,
    characterName: string,
    status: AssetPilotStatus,
    error: string | null,
    now: number,
  ): Promise<void> | void;
  deleteForUser(userId: string): Promise<void> | void;
}

export function migrateAssetSnapshotsDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS asset_snapshots (
      user_id TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      character_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      last_refreshed_at INTEGER,
      snapshot_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_snapshots_user ON asset_snapshots(user_id);
  `);
}

export function createSqliteAssetSnapshotStore(database: SqliteDatabase): AssetSnapshotStore {
  return {
    listSnapshots(userId, now = Date.now()) {
      const rows = database.prepare(`
        SELECT snapshot_json FROM asset_snapshots WHERE user_id = ? ORDER BY character_name
      `).all(userId) as Array<{ snapshot_json: string }>;
      return rows.map(row => withStaleStatus(JSON.parse(row.snapshot_json) as AssetSnapshot, now));
    },

    replaceSnapshot(userId, snapshot) {
      database.prepare(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          last_refreshed_at = excluded.last_refreshed_at,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(
        userId,
        snapshot.pilot.characterId,
        snapshot.pilot.characterName,
        snapshot.pilot.status,
        snapshot.pilot.error,
        snapshot.pilot.lastRefreshedAt,
        JSON.stringify(snapshot),
        Date.now(),
      );
    },

    recordPilotStatus(userId, characterId, characterName, status, error, now) {
      const snapshot: AssetSnapshot = {
        pilot: {
          characterId,
          characterName,
          status,
          error,
          lastRefreshedAt: null,
          locationCount: 0,
          itemCount: 0,
          stackCount: 0,
          pricedValue: 0,
          totalValue: 0,
          unpricedStacks: 0,
        },
        locations: [],
        categories: [],
      };
      database.prepare(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(userId, characterId, characterName, status, error, JSON.stringify(snapshot), now);
    },

    deleteForUser(userId) {
      database.prepare('DELETE FROM asset_snapshots WHERE user_id = ?').run(userId);
    },
  };
}

export function createPostgresAssetSnapshotStore(client: QueryClient = getPostgresPool()): AssetSnapshotStore {
  return {
    async listSnapshots(userId, now = Date.now()) {
      const rows = await client.query<{ snapshot_json: AssetSnapshot | string }>(
        'SELECT snapshot_json FROM asset_snapshots WHERE user_id = $1 ORDER BY character_name',
        [userId],
      );
      return rows.rows.map(row => withStaleStatus(
        typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) as AssetSnapshot : row.snapshot_json,
        now,
      ));
    },

    async replaceSnapshot(userId, snapshot) {
      await client.query(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7::jsonb, NOW())
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          last_refreshed_at = excluded.last_refreshed_at,
          snapshot_json = excluded.snapshot_json,
          updated_at = NOW()
      `, [
        userId,
        snapshot.pilot.characterId,
        snapshot.pilot.characterName,
        snapshot.pilot.status,
        snapshot.pilot.error,
        snapshot.pilot.lastRefreshedAt,
        JSON.stringify(snapshot),
      ]);
    },

    async recordPilotStatus(userId, characterId, characterName, status, error, now) {
      const snapshot: AssetSnapshot = {
        pilot: {
          characterId,
          characterName,
          status,
          error,
          lastRefreshedAt: null,
          locationCount: 0,
          itemCount: 0,
          stackCount: 0,
          pricedValue: 0,
          totalValue: 0,
          unpricedStacks: 0,
        },
        locations: [],
        categories: [],
      };
      await client.query(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb, to_timestamp($7 / 1000.0))
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `, [userId, characterId, characterName, status, error, JSON.stringify(snapshot), now]);
    },

    async deleteForUser(userId) {
      await client.query('DELETE FROM asset_snapshots WHERE user_id = $1', [userId]);
    },
  };
}

function withStaleStatus(snapshot: AssetSnapshot, now: number): AssetSnapshot {
  if (
    snapshot.pilot.status === 'Ready'
    && snapshot.pilot.lastRefreshedAt != null
    && now - snapshot.pilot.lastRefreshedAt > ASSET_STALE_MS
  ) {
    return { ...snapshot, pilot: { ...snapshot.pilot, status: 'Stale' } };
  }
  return snapshot;
}
```

- [ ] **Step 4: Add Postgres schema**

Append to `src/db/migrations/0001_multi_tenant_foundation.sql`:

```sql
CREATE TABLE IF NOT EXISTS asset_snapshots (
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id       BIGINT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  character_name     TEXT NOT NULL,
  status             TEXT NOT NULL,
  error              TEXT,
  last_refreshed_at  TIMESTAMPTZ,
  snapshot_json      JSONB NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_snapshots_user ON asset_snapshots(user_id);
```

- [ ] **Step 5: Run focused tests**

Run: `node --import tsx --test src/assets/store.test.ts src/db/migrations.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/assets/store.ts src/assets/store.test.ts src/db/migrations/0001_multi_tenant_foundation.sql
git commit -m "feat: store cached asset snapshots"
```

---

### Task 3: ESI Asset Refresh Service

**Files:**
- Create: `src/esi/assets.ts`
- Create: `src/assets/refresh.ts`
- Test: `src/assets/refresh.test.ts`

**Interfaces:**
- Consumes: `AssetSnapshotStore`, `AsyncCharacterStore`, `quoteResolvedMarketItems`, `resolveItemByTypeId`, `resolveStation`, `resolveSystem`, `resolveStructure`.
- Produces: `refreshPilotAssets(input)`, `refreshAllAssets(input)`, `summarizeAssets(snapshots)`.

- [ ] **Step 1: Write refresh tests**

Create `src/assets/refresh.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshAllAssets, refreshPilotAssets, summarizeAssets } from './refresh.ts';
import { createSqliteAssetSnapshotStore, migrateAssetSnapshotsDb } from './store.ts';
import Database from 'better-sqlite3';

function store() {
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  return createSqliteAssetSnapshotStore(db);
}

const character = {
  character_id: 123,
  user_id: 'user-a',
  character_name: 'Asset Pilot',
  owner_hash: 'owner',
  scopes: 'esi-assets.read_assets.v1',
  refresh_token: 'refresh',
  access_token: null,
  access_token_expires_at: null,
  added_at: 1,
  needs_reauth: 0 as const,
  is_boss: 0 as const,
};

test('refreshPilotAssets stores priced nested snapshot for one pilot', async () => {
  const snapshots = store();
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character,
    store: snapshots,
    now: () => 1_700_000_000_000,
    fetchAssets: async () => [
      { item_id: 1, type_id: 587, quantity: 1, location_id: 60003760, location_type: 'station', location_flag: 'Hangar', is_singleton: true },
      { item_id: 2, type_id: 34, quantity: 100, location_id: 1, location_type: 'item', location_flag: 'Cargo', is_singleton: false },
    ],
    resolveItem: typeId => typeId === 587
      ? { typeId, name: 'Rifter', groupId: 25, groupName: 'Frigate', categoryId: 6, categoryName: 'Ship' }
      : { typeId, name: 'Tritanium', groupId: 18, groupName: 'Mineral', categoryId: 4, categoryName: 'Material' },
    resolveLocation: async () => ({ locationId: 60003760, name: 'Jita IV - Moon 4', type: 'station', status: 'resolved' }),
    quoteItems: async (_hub, items) => ({
      hub: 'jita',
      systemName: 'Jita',
      regionName: 'The Forge',
      fetchedAt: 1,
      totalCost: 1_000_500,
      counts: { ok: 2, partial: 0, noOrders: 0, unknown: 0 },
      items: items.map(item => ({
        inputName: item.inputName,
        resolvedName: item.resolvedName,
        typeId: item.typeId,
        requestedQty: item.requestedQty,
        filledQty: item.requestedQty,
        totalCost: item.typeId === 587 ? 1_000_000 : 500,
        avgPrice: item.typeId === 587 ? 1_000_000 : 5,
        shortfall: 0,
        status: 'ok',
        bucket: item.bucket,
      })),
    }),
  });

  assert.equal(result.pilot.status, 'Ready');
  assert.equal(result.pilot.totalValue, 1_000_500);
  assert.equal(result.locations[0].assets[0].children[0].name, 'Tritanium');
});

test('refreshPilotAssets records missing asset scope without calling ESI', async () => {
  const snapshots = store();
  let called = false;
  const result = await refreshPilotAssets({
    userId: 'user-a',
    character: { ...character, scopes: 'esi-location.read_location.v1' },
    store: snapshots,
    now: () => 1_700_000_000_000,
    fetchAssets: async () => {
      called = true;
      return [];
    },
  });

  assert.equal(called, false);
  assert.equal(result.pilot.status, 'Missing asset scope');
});

test('refreshAllAssets limits concurrency and returns per-pilot results', async () => {
  const snapshots = store();
  let active = 0;
  let maxActive = 0;
  const characters = [1, 2, 3].map(id => ({ ...character, character_id: id, character_name: `Pilot ${id}` }));

  const results = await refreshAllAssets({
    userId: 'user-a',
    characters,
    store: snapshots,
    concurrency: 2,
    now: () => 1_700_000_000_000,
    refreshOne: async input => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return {
        pilot: {
          characterId: input.character.character_id,
          characterName: input.character.character_name,
          status: 'Ready',
          error: null,
          lastRefreshedAt: 1,
          locationCount: 0,
          itemCount: 0,
          stackCount: 0,
          pricedValue: 0,
          totalValue: 0,
          unpricedStacks: 0,
        },
        locations: [],
        categories: [],
      };
    },
  });

  assert.equal(results.length, 3);
  assert.equal(maxActive, 2);
});

test('summarizeAssets builds dashboard totals across snapshots', () => {
  const summary = summarizeAssets([{
    pilot: {
      characterId: 1,
      characterName: 'One',
      status: 'Ready',
      error: null,
      lastRefreshedAt: 10,
      locationCount: 1,
      itemCount: 2,
      stackCount: 1,
      pricedValue: 100,
      totalValue: 100,
      unpricedStacks: 0,
    },
    locations: [],
    categories: [{ key: 'ships', label: 'Ships', itemCount: 1, stackCount: 1, pricedValue: 100, totalValue: 100, unpricedStacks: 0 }],
  }]);

  assert.equal(summary.totalValue, 100);
  assert.equal(summary.lastRefreshedAt, 10);
  assert.equal(summary.categories[0].key, 'ships');
});
```

- [ ] **Step 2: Run refresh tests to verify they fail**

Run: `node --import tsx --test src/assets/refresh.test.ts`

Expected: FAIL because `src/assets/refresh.ts` does not exist.

- [ ] **Step 3: Implement ESI assets wrapper**

Create `src/esi/assets.ts`:

```ts
import { esiGet } from './client.ts';

export interface EsiCharacterAsset {
  item_id: number;
  type_id: number;
  quantity: number;
  location_id: number;
  location_type: 'station' | 'solar_system' | 'item' | 'other';
  location_flag: string;
  is_singleton: boolean;
  is_blueprint_copy?: boolean;
}

export async function getCharacterAssets(characterId: number): Promise<EsiCharacterAsset[]> {
  const first = await esiGet<EsiCharacterAsset[]>(`/characters/${characterId}/assets/?page=1`, characterId);
  const out = [...first.data];
  const pages = first.pages ?? 1;
  for (let page = 2; page <= pages; page++) {
    const { data } = await esiGet<EsiCharacterAsset[]>(`/characters/${characterId}/assets/?page=${page}`, characterId);
    out.push(...data);
  }
  return out;
}
```

- [ ] **Step 4: Implement refresh service**

Create `src/assets/refresh.ts` with these exported signatures:

```ts
export interface RefreshPilotAssetsInput {
  userId: string;
  character: CharacterRow;
  store: AssetSnapshotStore;
  now?: () => number;
  fetchAssets?: (characterId: number) => Promise<EsiCharacterAsset[]>;
  resolveItem?: (typeId: number) => AssetItemMetadata | null;
  resolveLocation?: (locationId: number, locationType: string, characterId: number) => Promise<RawAssetLocationInput>;
  quoteItems?: typeof quoteResolvedMarketItems;
}

export async function refreshPilotAssets(input: RefreshPilotAssetsInput): Promise<AssetSnapshot>;

export interface RefreshAllAssetsInput extends Omit<RefreshPilotAssetsInput, 'character'> {
  characters: CharacterRow[];
  concurrency?: number;
  refreshOne?: (input: RefreshPilotAssetsInput) => Promise<AssetSnapshot>;
}

export async function refreshAllAssets(input: RefreshAllAssetsInput): Promise<AssetSnapshot[]>;

export function summarizeAssets(snapshots: AssetSnapshot[]): AssetDashboardResponse;
```

Core behavior:

```ts
if (character.needs_reauth === 1) {
  return recordStatus('Needs re-auth', 'Pilot needs re-authentication.');
}
if (!character.scopes.split(/\s+/).includes('esi-assets.read_assets.v1')) {
  return recordStatus('Missing asset scope', 'Pilot is missing esi-assets.read_assets.v1. Click Add character to re-auth.');
}
```

Default item resolution uses `resolveItemByTypeId`. If metadata is missing, build an `AssetItemMetadata` fallback:

```ts
{
  typeId,
  name: `Type ${typeId}`,
  groupId: 0,
  groupName: 'Unknown',
  categoryId: 0,
  categoryName: 'Unknown',
}
```

Default location resolution:

```ts
export async function resolveAssetLocation(locationId: number, locationType: string, characterId: number): Promise<RawAssetLocationInput> {
  if (locationType === 'station') {
    return { locationId, name: await resolveStation(locationId), type: 'station', status: 'resolved' };
  }
  if (locationType === 'solar_system') {
    return { locationId, name: await resolveSystem(locationId), type: 'solar_system', status: 'resolved' };
  }
  if (locationType === 'other') {
    const name = await resolveStructure(locationId, characterId);
    return { locationId, name: name ?? 'Unknown structure', type: 'structure', status: name ? 'resolved' : 'unresolved' };
  }
  return { locationId, name: `Unknown location ${locationId}`, type: locationType, status: 'unresolved' };
}
```

Pricing input groups by type ID:

```ts
const byType = new Map<number, { meta: AssetItemMetadata; quantity: number }>();
for (const asset of normalizedAssets) {
  const row = byType.get(asset.typeId) ?? { meta: asset, quantity: 0 };
  row.quantity += asset.quantity;
  byType.set(asset.typeId, row);
}
const quote = await quoteItems('jita', [...byType.values()].map(row => ({
  inputName: row.meta.name,
  resolvedName: row.meta.name,
  typeId: row.meta.typeId,
  requestedQty: row.quantity,
})));
const unitPrices = new Map(quote.items.map(item => [
  item.typeId,
  item.avgPrice != null && item.status !== 'no-orders' ? { unitValue: item.avgPrice, status: item.status === 'partial' ? 'partial' : 'priced' } : { unitValue: null, status: 'unpriced' },
]));
```

Then build `RawAssetInput[]`, resolve root locations, call `buildAssetTree`, store with `replaceSnapshot`, and return the snapshot.

- [ ] **Step 5: Run focused refresh tests**

Run: `node --import tsx --test src/assets/refresh.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/esi/assets.ts src/assets/refresh.ts src/assets/refresh.test.ts
git commit -m "feat: refresh cached pilot assets"
```

---

### Task 4: Private Assets API Routes And Runtime Wiring

**Files:**
- Create: `src/routes/assets.ts`
- Test: `src/routes/assets.test.ts`
- Modify: `src/auth/scopes.ts`
- Modify: `src/server.ts`
- Test: `src/server-postgres-runtime-view.test.ts`

**Interfaces:**
- Consumes: `AssetSnapshotStore`, `AsyncCharacterStore`, `refreshPilotAssets`, `refreshAllAssets`, `summarizeAssets`.
- Produces API:
  - `GET /api/assets`
  - `POST /api/assets/refresh`
  - `POST /api/assets/characters/:characterId/refresh`

- [ ] **Step 1: Write route tests**

Create `src/routes/assets.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { createSqliteAssetSnapshotStore, migrateAssetSnapshotsDb } from '../assets/store.ts';
import { registerAssetsRoutes } from './assets.ts';

function testStore() {
  const db = new Database(':memory:');
  migrateAssetSnapshotsDb(db);
  return createSqliteAssetSnapshotStore(db);
}

const userA = { id: 'user-a', email: null, role: 'user' as const, status: 'active' as const };
const pilot = {
  character_id: 123,
  user_id: 'user-a',
  character_name: 'Asset Pilot',
  owner_hash: 'owner',
  scopes: 'esi-assets.read_assets.v1',
  refresh_token: 'refresh',
  access_token: null,
  access_token_expires_at: null,
  added_at: 1,
  needs_reauth: 0 as const,
  is_boss: 0 as const,
};

test('assets routes require an authenticated user', async () => {
  const app = Fastify();
  registerAssetsRoutes(app, {
    currentUser: async () => null,
    store: testStore(),
    characters: { listByUser: async () => [], listUsableByUser: async () => [], getOwned: async () => undefined },
  });

  const res = await app.inject({ method: 'GET', url: '/api/assets' });
  assert.equal(res.statusCode, 401);
});

test('GET /api/assets returns cached user-scoped snapshots and dashboard', async () => {
  const store = testStore();
  store.recordPilotStatus('user-a', 123, 'Asset Pilot', 'Needs refresh', null, 1);
  store.recordPilotStatus('user-b', 456, 'Other Pilot', 'Needs refresh', null, 1);
  const app = Fastify();
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store,
    characters: { listByUser: async () => [pilot], listUsableByUser: async () => [pilot], getOwned: async () => pilot },
    now: () => 1,
  });

  const res = await app.inject({ method: 'GET', url: '/api/assets' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.pilots.length, 1);
  assert.equal(body.pilots[0].pilot.characterId, 123);
});

test('POST /api/assets/characters/:id/refresh scopes refresh to owned pilot', async () => {
  const app = Fastify();
  let refreshed = 0;
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store: testStore(),
    characters: { listByUser: async () => [pilot], listUsableByUser: async () => [pilot], getOwned: async (_userId, id) => id === 123 ? pilot : undefined },
    refreshPilot: async input => {
      refreshed++;
      return {
        pilot: {
          characterId: input.character.character_id,
          characterName: input.character.character_name,
          status: 'Ready',
          error: null,
          lastRefreshedAt: 1,
          locationCount: 0,
          itemCount: 0,
          stackCount: 0,
          pricedValue: 0,
          totalValue: 0,
          unpricedStacks: 0,
        },
        locations: [],
        categories: [],
      };
    },
  });

  const ok = await app.inject({ method: 'POST', url: '/api/assets/characters/123/refresh' });
  assert.equal(ok.statusCode, 200);
  assert.equal(refreshed, 1);

  const missing = await app.inject({ method: 'POST', url: '/api/assets/characters/456/refresh' });
  assert.equal(missing.statusCode, 404);
});

test('POST /api/assets/refresh refreshes all usable owned pilots', async () => {
  const app = Fastify();
  registerAssetsRoutes(app, {
    currentUser: async () => userA,
    store: testStore(),
    characters: { listByUser: async () => [pilot], listUsableByUser: async () => [pilot], getOwned: async () => pilot },
    refreshAll: async input => input.characters.map(character => ({
      pilot: {
        characterId: character.character_id,
        characterName: character.character_name,
        status: 'Ready',
        error: null,
        lastRefreshedAt: 1,
        locationCount: 0,
        itemCount: 0,
        stackCount: 0,
        pricedValue: 0,
        totalValue: 0,
        unpricedStacks: 0,
      },
      locations: [],
      categories: [],
    })),
  });

  const res = await app.inject({ method: 'POST', url: '/api/assets/refresh' });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).pilots.length, 1);
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `node --import tsx --test src/routes/assets.test.ts`

Expected: FAIL because `src/routes/assets.ts` does not exist.

- [ ] **Step 3: Implement routes**

Create `src/routes/assets.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { createCurrentUserResolver, type CurrentUserResolver } from '../auth/current-user.ts';
import type { AsyncCharacterStore } from '../characters/store.ts';
import { createPostgresCharacterStore } from '../characters/store.ts';
import { refreshAllAssets, refreshPilotAssets, summarizeAssets, type RefreshAllAssetsInput, type RefreshPilotAssetsInput } from '../assets/refresh.ts';
import { createPostgresAssetSnapshotStore, type AssetSnapshotStore } from '../assets/store.ts';

export interface AssetsRouteDeps {
  currentUser?: CurrentUserResolver;
  characters?: Pick<AsyncCharacterStore, 'listByUser' | 'listUsableByUser' | 'getOwned'>;
  store?: AssetSnapshotStore;
  now?: () => number;
  refreshPilot?: (input: RefreshPilotAssetsInput) => Promise<Awaited<ReturnType<typeof refreshPilotAssets>>>;
  refreshAll?: (input: RefreshAllAssetsInput) => Promise<Awaited<ReturnType<typeof refreshAllAssets>>>;
}

export function registerAssetsRoutes(app: FastifyInstance, deps: AssetsRouteDeps = {}) {
  const currentUser = deps.currentUser ?? createCurrentUserResolver();
  const characters = deps.characters ?? createPostgresCharacterStore();
  const store = deps.store ?? createPostgresAssetSnapshotStore();
  const now = deps.now ?? (() => Date.now());
  const refreshPilot = deps.refreshPilot ?? refreshPilotAssets;
  const refreshAll = deps.refreshAll ?? refreshAllAssets;

  app.get('/api/assets', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const snapshots = await store.listSnapshots(user.id, now());
    return { dashboard: summarizeAssets(snapshots), pilots: snapshots };
  });

  app.post('/api/assets/characters/:characterId/refresh', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const characterId = Number((req.params as { characterId: string }).characterId);
    const character = Number.isFinite(characterId) ? await characters.getOwned(user.id, characterId) : undefined;
    if (!character) return reply.code(404).send({ error: 'character_not_found' });

    const snapshot = await refreshPilot({ userId: user.id, character, store, now });
    const snapshots = await store.listSnapshots(user.id, now());
    return { dashboard: summarizeAssets(snapshots), snapshot };
  });

  app.post('/api/assets/refresh', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const owned = await characters.listUsableByUser(user.id);
    const snapshots = await refreshAll({ userId: user.id, characters: owned, store, now, concurrency: 2 });
    return { dashboard: summarizeAssets(await store.listSnapshots(user.id, now())), pilots: snapshots };
  });
}
```

- [ ] **Step 4: Add asset scope**

Modify `src/auth/scopes.ts`:

```ts
'esi-assets.read_assets.v1',
```

Add it near other read scopes, before write scopes.

- [ ] **Step 5: Wire routes in server**

Modify `src/server.ts`:

```ts
import { registerAssetsRoutes } from './routes/assets.ts';
import { createPostgresAssetSnapshotStore } from './assets/store.ts';
```

Instantiate and register:

```ts
const assetSnapshotStore = createPostgresAssetSnapshotStore();
registerAssetsRoutes(app, { characters: characterStore, store: assetSnapshotStore });
```

- [ ] **Step 6: Extend runtime view test**

Modify `src/server-postgres-runtime-view.test.ts` to assert `server.ts` includes:

```ts
assert.match(server, /registerAssetsRoutes\(app, \{ characters: characterStore, store: assetSnapshotStore \}\)/);
assert.match(server, /createPostgresAssetSnapshotStore/);
```

- [ ] **Step 7: Run focused route/runtime tests**

Run:

```bash
node --import tsx --test src/routes/assets.test.ts src/server-postgres-runtime-view.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/routes/assets.ts src/routes/assets.test.ts src/auth/scopes.ts src/server.ts src/server-postgres-runtime-view.test.ts
git commit -m "feat: add private assets api"
```

---

### Task 5: Frontend Assets View

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/AssetsView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ControlPanel.tsx`
- Modify: `web/src/styles.css`
- Test: `src/assets/assets-view.test.ts`

**Interfaces:**
- Consumes API from Task 4.
- Produces: `AssetsView` React component and sidebar `assets` view.

- [ ] **Step 1: Write frontend structure test**

Create `src/assets/assets-view.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('assets view is wired into navigation between fits and market', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const panel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');

  assert.match(app, /import \{ AssetsView \}/);
  assert.match(app, /view === 'assets'/);
  assert.match(panel, /type View = .*'assets'/s);
  assert.match(panel, />Fits<\/button>[\s\S]*view === 'assets'[\s\S]*>Assets<\/button>[\s\S]*>Market<\/button>/);
});

test('assets api helpers and component expose dashboard refresh search and expandable tree controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const view = readFileSync(resolve('web/src/components/AssetsView.tsx'), 'utf8');

  assert.match(api, /export interface AssetDashboard/);
  assert.match(api, /export async function fetchAssets/);
  assert.match(api, /export async function refreshAllAssets/);
  assert.match(api, /export async function refreshPilotAssets/);

  assert.match(view, /Refresh All/);
  assert.match(view, /Search assets/);
  assert.match(view, /All assets/);
  assert.match(view, /expandedPilots/);
  assert.match(view, /expandedLocations/);
  assert.match(view, /expandedAssets/);
});
```

- [ ] **Step 2: Run frontend structure test to verify it fails**

Run: `node --import tsx --test src/assets/assets-view.test.ts`

Expected: FAIL because `AssetsView.tsx` does not exist.

- [ ] **Step 3: Add API types and functions**

Append to `web/src/api.ts`:

```ts
// --- Assets ---

export type AssetPilotStatus = 'Ready' | 'Refreshing' | 'Needs refresh' | 'Stale' | 'Missing asset scope' | 'Needs re-auth' | 'Error';
export type AssetPricingStatus = 'priced' | 'partial' | 'unpriced';
export type AssetLocationStatus = 'resolved' | 'unresolved';

export interface AssetValueSummary {
  itemCount: number;
  stackCount: number;
  pricedValue: number;
  totalValue: number;
  unpricedStacks: number;
}

export interface AssetCategorySummary extends AssetValueSummary {
  key: string;
  label: string;
}

export interface AssetTreeNode extends AssetValueSummary {
  itemId: number;
  typeId: number;
  name: string;
  category: string;
  categoryLabel: string;
  quantity: number;
  unitValue: number | null;
  stackValue: number;
  pricingStatus: AssetPricingStatus;
  singleton: boolean;
  parentItemId: number | null;
  locationId: number;
  locationFlag: string;
  locationType: string;
  children: AssetTreeNode[];
}

export interface AssetLocationNode extends AssetValueSummary {
  locationId: number;
  name: string;
  type: string;
  status: AssetLocationStatus;
  rawLocationId: number;
  assets: AssetTreeNode[];
}

export interface AssetPilotSummary extends AssetValueSummary {
  characterId: number;
  characterName: string;
  status: AssetPilotStatus;
  locationCount: number;
  lastRefreshedAt: number | null;
  error: string | null;
}

export interface AssetSnapshot {
  pilot: AssetPilotSummary;
  locations: AssetLocationNode[];
  categories: AssetCategorySummary[];
}

export interface AssetDashboard extends AssetValueSummary {
  lastRefreshedAt: number | null;
  categories: AssetCategorySummary[];
}

export interface AssetsResponse {
  dashboard: AssetDashboard;
  pilots: AssetSnapshot[];
}

export async function fetchAssets(): Promise<AssetsResponse | { error: string }> {
  return jsonOrError(await fetch('/api/assets'));
}

export async function refreshAllAssets(): Promise<AssetsResponse | { error: string }> {
  return jsonOrError(await fetch('/api/assets/refresh', { method: 'POST' }));
}

export async function refreshPilotAssets(characterId: number): Promise<{ dashboard: AssetDashboard; snapshot: AssetSnapshot } | { error: string }> {
  return jsonOrError(await fetch(`/api/assets/characters/${characterId}/refresh`, { method: 'POST' }));
}
```

- [ ] **Step 4: Build AssetsView component**

Create `web/src/components/AssetsView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  fetchAssets,
  refreshAllAssets,
  refreshPilotAssets,
  type AssetDashboard,
  type AssetLocationNode,
  type AssetSnapshot,
  type AssetTreeNode,
} from '../api.ts';

export function AssetsView() {
  const [dashboard, setDashboard] = useState<AssetDashboard | null>(null);
  const [pilots, setPilots] = useState<AssetSnapshot[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPilots, setExpandedPilots] = useState<Set<number>>(new Set());
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchAssets().then(result => {
      if ('error' in result) setError(result.error);
      else {
        setDashboard(result.dashboard);
        setPilots(result.pilots);
      }
    });
  }, []);

  const filtered = useMemo(() => filterPilots(pilots, query, category), [pilots, query, category]);

  const doRefreshAll = async () => {
    setBusy('all');
    setError(null);
    const result = await refreshAllAssets();
    setBusy(null);
    if ('error' in result) setError(result.error);
    else {
      setDashboard(result.dashboard);
      setPilots(result.pilots);
      setExpandedPilots(new Set(result.pilots.map(p => p.pilot.characterId)));
    }
  };

  const doRefreshPilot = async (characterId: number) => {
    setBusy(String(characterId));
    setError(null);
    const result = await refreshPilotAssets(characterId);
    setBusy(null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setDashboard(result.dashboard);
    setPilots(current => {
      const next = current.filter(row => row.pilot.characterId !== result.snapshot.pilot.characterId);
      next.push(result.snapshot);
      next.sort((a, b) => a.pilot.characterName.localeCompare(b.pilot.characterName));
      return next;
    });
    setExpandedPilots(current => new Set(current).add(characterId));
  };

  return (
    <main className="assets-view">
      <section className="assets-dashboard" aria-label="Assets dashboard">
        <SummaryCard label="Total Estimated Value" value={formatIsk(dashboard?.totalValue ?? 0)} />
        <SummaryCard label="Priced Value" value={formatIsk(dashboard?.pricedValue ?? 0)} />
        <SummaryCard label="Unpriced Stacks" value={(dashboard?.unpricedStacks ?? 0).toLocaleString()} />
        <SummaryCard label="Last Refresh" value={formatTime(dashboard?.lastRefreshedAt ?? null)} />
        <button className={`asset-category-card${category === 'all' ? ' active' : ''}`} onClick={() => setCategory('all')}>
          <strong>All assets</strong>
          <span>{formatIsk(dashboard?.totalValue ?? 0)}</span>
        </button>
        {(dashboard?.categories ?? []).map(card => (
          <button key={card.key} className={`asset-category-card${category === card.key ? ' active' : ''}`} onClick={() => setCategory(card.key)}>
            <strong>{card.label}</strong>
            <span>{formatIsk(card.totalValue)}</span>
            <small>{card.itemCount.toLocaleString()} items · {card.stackCount.toLocaleString()} stacks</small>
          </button>
        ))}
      </section>

      <section className="assets-controls" aria-label="Assets controls">
        <button className="primary" onClick={doRefreshAll} disabled={busy != null}>{busy === 'all' ? 'Refreshing…' : 'Refresh All'}</button>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search assets" />
        {category !== 'all' && <button onClick={() => setCategory('all')}>Clear filter</button>}
        {error && <span className="asset-error">{error}</span>}
      </section>

      <section className="assets-tree" aria-label="Assets tree">
        {filtered.map(snapshot => (
          <PilotRow
            key={snapshot.pilot.characterId}
            snapshot={snapshot}
            busy={busy === String(snapshot.pilot.characterId)}
            expandedPilots={expandedPilots}
            expandedLocations={expandedLocations}
            expandedAssets={expandedAssets}
            setExpandedPilots={setExpandedPilots}
            setExpandedLocations={setExpandedLocations}
            setExpandedAssets={setExpandedAssets}
            onRefresh={doRefreshPilot}
          />
        ))}
        {filtered.length === 0 && <div className="assets-empty">No assets found.</div>}
      </section>
    </main>
  );
}
```

Continue the file with compact helper components:

```tsx
function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="asset-summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function PilotRow(props: {
  snapshot: AssetSnapshot;
  busy: boolean;
  expandedPilots: Set<number>;
  expandedLocations: Set<string>;
  expandedAssets: Set<number>;
  setExpandedPilots: (fn: (current: Set<number>) => Set<number>) => void;
  setExpandedLocations: (fn: (current: Set<string>) => Set<string>) => void;
  setExpandedAssets: (fn: (current: Set<number>) => Set<number>) => void;
  onRefresh: (characterId: number) => void;
}) {
  const { snapshot } = props;
  const id = snapshot.pilot.characterId;
  const open = props.expandedPilots.has(id);
  return (
    <div className="asset-pilot">
      <button className="asset-row asset-pilot-row" onClick={() => props.setExpandedPilots(s => toggled(s, id))}>
        <span>{open ? '▾' : '▸'}</span>
        <strong>{snapshot.pilot.characterName}</strong>
        <span>{snapshot.pilot.status}</span>
        <span>{formatIsk(snapshot.pilot.totalValue)}</span>
        <span>{snapshot.pilot.locationCount} locations</span>
        <span>{formatTime(snapshot.pilot.lastRefreshedAt)}</span>
      </button>
      <button className="asset-refresh-small" disabled={props.busy} onClick={() => props.onRefresh(id)}>{props.busy ? 'Refreshing…' : 'Refresh'}</button>
      {snapshot.pilot.error && <div className="asset-row-note">{snapshot.pilot.error}</div>}
      {open && snapshot.locations.map(location => (
        <LocationRow key={`${id}:${location.locationId}`} pilotId={id} location={location} {...props} />
      ))}
    </div>
  );
}

function LocationRow(props: {
  pilotId: number;
  location: AssetLocationNode;
  expandedLocations: Set<string>;
  expandedAssets: Set<number>;
  setExpandedLocations: (fn: (current: Set<string>) => Set<string>) => void;
  setExpandedAssets: (fn: (current: Set<number>) => Set<number>) => void;
}) {
  const key = `${props.pilotId}:${props.location.locationId}`;
  const open = props.expandedLocations.has(key);
  return (
    <div className="asset-location">
      <button className="asset-row asset-location-row" onClick={() => props.setExpandedLocations(s => toggled(s, key))}>
        <span>{open ? '▾' : '▸'}</span>
        <strong>{props.location.name}</strong>
        <span>{props.location.status === 'unresolved' ? `unresolved · ${props.location.rawLocationId}` : props.location.type}</span>
        <span>{formatIsk(props.location.totalValue)}</span>
        <span>{props.location.stackCount} stacks</span>
      </button>
      {open && props.location.assets.map(asset => <AssetRow key={asset.itemId} asset={asset} depth={0} {...props} />)}
    </div>
  );
}

function AssetRow(props: {
  asset: AssetTreeNode;
  depth: number;
  expandedAssets: Set<number>;
  setExpandedAssets: (fn: (current: Set<number>) => Set<number>) => void;
}) {
  const hasChildren = props.asset.children.length > 0;
  const open = props.expandedAssets.has(props.asset.itemId);
  return (
    <div className="asset-node">
      <button className="asset-row asset-item-row" style={{ paddingLeft: 24 + props.depth * 18 }} onClick={() => hasChildren && props.setExpandedAssets(s => toggled(s, props.asset.itemId))}>
        <span>{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <img src={`https://images.evetech.net/types/${props.asset.typeId}/icon?size=32`} alt="" />
        <strong>{props.asset.name}</strong>
        <span>{props.asset.categoryLabel}</span>
        <span>{props.asset.quantity.toLocaleString()}</span>
        <span>{props.asset.unitValue == null ? '—' : formatIsk(props.asset.unitValue)}</span>
        <span>{formatIsk(props.asset.stackValue)}</span>
        <span>{props.asset.pricingStatus}</span>
      </button>
      {open && props.asset.children.map(child => <AssetRow key={child.itemId} asset={child} depth={props.depth + 1} expandedAssets={props.expandedAssets} setExpandedAssets={props.setExpandedAssets} />)}
    </div>
  );
}
```

And pure helpers:

```tsx
function toggled<T>(current: Set<T>, key: T): Set<T> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function formatIsk(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T ISK`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B ISK`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M ISK`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K ISK`;
  return `${Math.round(value).toLocaleString()} ISK`;
}

function formatTime(value: number | null): string {
  if (value == null) return 'Never';
  return new Date(value).toLocaleString();
}

function filterPilots(pilots: AssetSnapshot[], query: string, category: string): AssetSnapshot[] {
  const q = query.trim().toLowerCase();
  return pilots
    .map(snapshot => filterSnapshot(snapshot, q, category))
    .filter((snapshot): snapshot is AssetSnapshot => snapshot != null);
}

function filterSnapshot(snapshot: AssetSnapshot, query: string, category: string): AssetSnapshot | null {
  const pilotMatches = matches(snapshot.pilot.characterName, query);
  const locations = snapshot.locations
    .map(location => filterLocation(location, query, category, pilotMatches))
    .filter((location): location is AssetLocationNode => location != null);
  if (pilotMatches || locations.length > 0 || (query === '' && category === 'all')) {
    return { ...snapshot, locations };
  }
  return null;
}

function filterLocation(location: AssetLocationNode, query: string, category: string, parentMatches: boolean): AssetLocationNode | null {
  const selfMatches = parentMatches || matches(location.name, query);
  const assets = location.assets
    .map(asset => filterAsset(asset, query, category, selfMatches))
    .filter((asset): asset is AssetTreeNode => asset != null);
  if (selfMatches || assets.length > 0 || (query === '' && category === 'all')) return { ...location, assets };
  return null;
}

function filterAsset(asset: AssetTreeNode, query: string, category: string, parentMatches: boolean): AssetTreeNode | null {
  const categoryMatches = category === 'all' || asset.category === category;
  const selfMatches = parentMatches || matches(asset.name, query) || matches(asset.categoryLabel, query);
  const children = asset.children
    .map(child => filterAsset(child, query, category, selfMatches))
    .filter((child): child is AssetTreeNode => child != null);
  if ((selfMatches && categoryMatches) || children.length > 0 || (query === '' && categoryMatches)) return { ...asset, children };
  return null;
}

function matches(value: string, query: string): boolean {
  return query === '' || value.toLowerCase().includes(query);
}
```

- [ ] **Step 5: Wire App and nav**

Modify `web/src/App.tsx`:

```tsx
import { AssetsView } from './components/AssetsView.tsx';
```

Add `assets` to view union and render:

```tsx
{view === 'assets' && <AssetsView />}
```

Modify `web/src/components/ControlPanel.tsx`:

```ts
type View = 'pilots' | 'planets' | 'skills' | 'fleet' | 'market' | 'industry' | 'contracts' | 'fits' | 'assets';
```

Add button between Fits and Market:

```tsx
<button
  className={`nav-btn${view === 'assets' ? ' active' : ''}`}
  onClick={() => setView('assets')}
>Assets</button>
```

Change `view-nav-7` to `view-nav-8` or remove the numeric suffix if CSS does not depend on it.

- [ ] **Step 6: Add assets styles**

Append to `web/src/styles.css`:

```css
/* Assets */
.assets-view {
  padding: 24px;
  display: grid;
  gap: 16px;
}

.assets-dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.asset-summary-card,
.asset-category-card {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 8px;
  padding: 12px;
  color: var(--text);
  text-align: left;
}

.asset-category-card {
  cursor: pointer;
}

.asset-category-card.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.asset-summary-card span,
.asset-category-card small {
  display: block;
  color: var(--dim);
}

.asset-summary-card strong,
.asset-category-card strong {
  display: block;
  margin-bottom: 4px;
}

.assets-controls {
  display: flex;
  gap: 10px;
  align-items: center;
}

.assets-controls input {
  min-width: 280px;
}

.asset-error {
  color: var(--red);
}

.assets-tree {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.asset-row {
  width: 100%;
  display: grid;
  grid-template-columns: 24px minmax(220px, 1fr) 150px 130px 110px 130px 120px;
  align-items: center;
  gap: 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  padding: 10px 12px;
  text-align: left;
}

.asset-pilot-row {
  grid-template-columns: 24px minmax(220px, 1fr) 150px 130px 130px 180px;
  background: var(--panel-strong);
}

.asset-location-row {
  padding-left: 28px;
  background: var(--panel);
}

.asset-item-row img {
  width: 32px;
  height: 32px;
  border-radius: 4px;
}

.asset-refresh-small {
  margin: 8px 12px;
}

.asset-row-note,
.assets-empty {
  padding: 10px 12px;
  color: var(--dim);
}
```

- [ ] **Step 7: Run frontend structure test and build**

Run:

```bash
node --import tsx --test src/assets/assets-view.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add web/src/api.ts web/src/components/AssetsView.tsx web/src/App.tsx web/src/components/ControlPanel.tsx web/src/styles.css src/assets/assets-view.test.ts
git commit -m "feat: add assets dashboard view"
```

---

### Task 6: Full Verification, Local Run, And Deployment Prep

**Files:**
- Modify only if tests reveal defects in files touched by Tasks 1-5.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified implementation ready for local testing, push, and Railway deployment.

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: PASS with existing Postgres integration skips when `DATABASE_URL` and `TEST_DATABASE_URL` are absent.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS and Vite emits production assets.

- [ ] **Step 3: Start local dev server**

Run: `npm run dev`

Expected: local app starts on the configured dev URL. Keep the process running and report the local URL to the user.

- [ ] **Step 4: Manual smoke checklist**

In the local app:

- Assets tab appears between Fits and Market.
- Empty/no-snapshot state shows pilots with `Needs refresh` or existing snapshot statuses.
- `Refresh All` invokes the API.
- Pilots without `esi-assets.read_assets.v1` show `Missing asset scope`.
- A successful snapshot shows dashboard totals, category cards, pilot rows, locations, and asset rows.
- Category card click filters the tree.
- Search preserves parent rows for matching descendants.

- [ ] **Step 5: Commit verification fixes if needed**

If Step 1-4 required fixes:

```bash
git add src/assets src/esi/assets.ts src/routes/assets.ts src/auth/scopes.ts src/server.ts src/server-postgres-runtime-view.test.ts src/db/migrations/0001_multi_tenant_foundation.sql web/src/api.ts web/src/components/AssetsView.tsx web/src/App.tsx web/src/components/ControlPanel.tsx web/src/styles.css
git commit -m "fix: polish assets view verification"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 6: Push and deploy**

Run:

```bash
git push origin main
```

Then monitor Railway production deployment for service `low-manager` in environment `production` until the latest deployment reaches `SUCCESS`.

- [ ] **Step 7: Production health check**

Check:

```js
const res = await fetch('https://outfit420-2.com/api/health');
console.log(res.status, await res.text());
```

Expected: `200 {"ok":true}`.

---

## Self-Review

- Spec coverage: The plan covers private character-owned assets, cached snapshots, manual refresh, stale status, missing scope, location fallback, nested trees, dashboard categories, Jita valuation, sidebar placement, frontend search/filter, and testing.
- Placeholder scan: No task uses placeholder instructions; each task names files, interfaces, commands, expected outcomes, and concrete code shapes.
- Type consistency: Server response types use `AssetSnapshot`, `AssetDashboard`, `AssetPilotStatus`, and matching frontend interfaces. Route names match API helper names.
