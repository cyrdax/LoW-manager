# Fits Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a top-level Fits tab where users can import one EFT-style ship fit, preview it with zKillboard-style slot icons and prices, manually save it globally, copy normalized EFT, and create the fit in-game for a selected authenticated pilot.

**Architecture:** The server owns fit parsing, item/ship resolution, slot assignment, persistence, pricing, and ESI fitting export. The React view renders normalized fit shapes from the API, keeps unsaved drafts in memory only, and reuses authenticated character state only for the send-to-pilot dropdown. Shared market order-book code is extracted before Fits pricing so Shopping List and Fits walk the same hub sell orders.

**Tech Stack:** Fastify, TypeScript ESM, better-sqlite3, React/Vite, Node `node:test`, EVE ESI, cached Fuzzwork CSV/SDE-derived mastery data.

## Global Constraints

- Saved fits are global to the app, not owned by a character.
- Exactly one EFT header is supported per import.
- Import preview never autosaves; drafts are in memory only and do not survive refresh/navigation.
- Manual Save is the only persistence path.
- Hub selector supports Jita by default and Amarr as the alternate.
- Show hull total, fitted modules + rigs total, extras total, and grand total.
- Use EVE item icons from `https://images.evetech.net/types/{typeId}/icon?size=64`.
- Hovering an icon or item row shows the item name.
- Slot placeholders are required for high, mid, low, rig, service, and subsystem slots.
- Unknown/unmatched items are excluded from price totals and listed in an alert modal after preview.
- Implants and boosters are treated as cargo/extras.
- In-game export uses `POST /characters/{character_id}/fittings/` and requires `esi-fittings.write_fittings.v1`.
- ESI send excludes unmatched and unassignable rows and shows a warning before sending when anything is excluded.

---

## File Structure

- Create `src/market/pricing.ts`: shared hub metadata, public market order cache, type-name resolution, order-book walking, shopping-list quote, and resolved-item quote helpers.
- Modify `src/routes/market.ts`: keep PLEX and shopping-list routes, import shared pricing helpers, and retain EVEmail formatting.
- Create `src/fits/types.ts`: shared backend fit domain types used by parser, metadata, store, pricing, ESI, and routes.
- Create `src/fits/parser.ts`: pure EFT text parser, loaded-charge splitting, quantity suffix parsing, and normalized EFT rendering.
- Create `src/fits/metadata.ts`: mastery/SDE-backed ship lookup, item lookup, item classification, and dogma slot layout extraction.
- Create `src/fits/assignment.ts`: section-to-slot assignment, ESI flag assignment, warning generation, and grouped display rows.
- Create `src/fits/store.ts`: SQLite migration plus saved fit CRUD.
- Create `src/fits/pricing.ts`: fit quote assembly using `quoteResolvedMarketItems`.
- Create `src/fits/esi.ts`: ESI fitting payload builder and create-fitting POST wrapper.
- Create `src/routes/fits.ts`: preview, CRUD, ship search, quote, and send endpoints.
- Modify `src/db.ts`: run `migrateFitsDb(db)`.
- Modify `src/server.ts`: register Fits routes.
- Modify `src/auth/scopes.ts`: add `esi-fittings.write_fittings.v1`.
- Modify `web/src/api.ts`: add Fits API types and fetch helpers.
- Create `web/src/components/FitsView.tsx`: import modal, unmatched modal, saved library, fit detail, pricing, copy EFT, and send controls.
- Modify `web/src/App.tsx`: add `fits` view.
- Modify `web/src/components/ControlPanel.tsx`: add Fits navigation button.
- Modify `web/src/styles.css`: Fits layout, slot grids, icons, tooltips, warnings, modals, and responsive constraints.

## Task 1: Extract Shared Market Pricing

**Files:**
- Create: `src/market/pricing.ts`
- Create: `src/market/pricing.test.ts`
- Modify: `src/routes/market.ts`

**Interfaces:**
- Produces:
  - `export type HubKey = 'jita' | 'amarr'`
  - `export const HUBS: Record<HubKey, HubInfo>`
  - `export interface MarketOrder`
  - `export interface QuotedMarketItem`
  - `export function walkOrderBook(orders: MarketOrder[], systemId: number, qty: number): OrderBookFill`
  - `export async function quoteShoppingListItems(hubKey: HubKey, rawItems: Array<{ name?: string; qty?: number }>, deps?: PricingDeps): Promise<MarketQuoteResult>`
  - `export async function quoteResolvedMarketItems(hubKey: HubKey, rawItems: ResolvedMarketRequestItem[], deps?: PricingDeps): Promise<MarketQuoteResult>`
  - `export async function getHistory(regionId: number, typeId: number): Promise<HistoryEntry[]>`
  - `export async function getOrders(regionId: number, typeId: number): Promise<MarketOrder[]>`
- Consumes:
  - `esiGetPublic` and `esiPostPublic` from `src/esi/client.ts`

- [ ] **Step 1: Write failing pricing tests**

Add `src/market/pricing.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quoteResolvedMarketItems, quoteShoppingListItems, walkOrderBook, type MarketOrder } from './pricing.ts';

function order(price: number, volume: number, systemId = 30000142): MarketOrder {
  return {
    order_id: price,
    type_id: 34,
    location_id: 60003760,
    system_id: systemId,
    is_buy_order: false,
    price,
    volume_remain: volume,
    volume_total: volume,
    min_volume: 1,
    duration: 90,
    issued: '2026-07-09T00:00:00Z',
    range: 'region',
  };
}

describe('market pricing', () => {
  it('walks cheapest in-system sell orders first', () => {
    const fill = walkOrderBook([order(30, 5), order(10, 2), order(5, 99, 30002187)], 30000142, 4);
    assert.deepEqual(fill, { totalCost: 80, filledQty: 4, shortfall: 0 });
  });

  it('quotes resolved type IDs without resolving names through ESI', async () => {
    const quote = await quoteResolvedMarketItems('jita', [
      { inputName: 'Tritanium', resolvedName: 'Tritanium', typeId: 34, requestedQty: 4, bucket: 'extras' },
    ], {
      getOrders: async () => [order(10, 2), order(20, 5)],
    });
    assert.equal(quote.totalCost, 60);
    assert.equal(quote.items[0].bucket, 'extras');
    assert.equal(quote.items[0].status, 'ok');
  });

  it('dedupes shopping-list names before quoting', async () => {
    const quote = await quoteShoppingListItems('jita', [
      { name: 'Tritanium', qty: 2 },
      { name: 'Tritanium', qty: 3 },
    ], {
      resolveTypeIds: async names => new Map(names.map(name => [name, 34])),
      getOrders: async () => [order(7, 10)],
    });
    assert.equal(quote.items.length, 1);
    assert.equal(quote.items[0].requestedQty, 5);
    assert.equal(quote.totalCost, 35);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/market/pricing.test.ts`

Expected: FAIL because `src/market/pricing.ts` does not exist.

- [ ] **Step 3: Move pricing implementation**

Create `src/market/pricing.ts` by moving the existing shopping-list market primitives from `src/routes/market.ts` and adding the resolved-item helper. Preserve the existing order-cache TTLs, ESI request paths, and hub definitions. The helper must treat `typeId: null` as `unknown-item`, use the supplied `bucket` on returned rows, and use dependency injection for tests.

- [ ] **Step 4: Update Market routes**

Modify `src/routes/market.ts` to import `HUBS`, `HubKey`, `getHistory`, `getOrders`, `quoteShoppingListItems`, and `MarketQuoteResult` from `src/market/pricing.ts`. Keep `formatShoppingMailBody` behavior equivalent by accepting `MarketQuoteResult`.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/market/pricing.test.ts src/market/shopping-list-parser.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/market/pricing.ts src/market/pricing.test.ts src/routes/market.ts
git commit -m "refactor: share market pricing"
```

## Task 2: Parse EFT Text and Render Normalized EFT

**Files:**
- Create: `src/fits/types.ts`
- Create: `src/fits/parser.ts`
- Create: `src/fits/parser.test.ts`

**Interfaces:**
- Produces:
  - `export interface ParsedFitText`
  - `export interface ParsedFitLine`
  - `export function parseEftFit(rawEft: string): ParsedFitText`
  - `export function renderEftFit(input: RenderEftInput): string`
- Consumes:
  - No external IO.

- [ ] **Step 1: Write failing parser tests**

Add `src/fits/parser.test.ts` with tests for:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEftFit, renderEftFit } from './parser.ts';

const naglfar = `[Naglfar, Simulated Naglfar Fitting]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Quad 800mm Repeating Cannon II
Siege Module II
Armor Command Burst II, Rapid Repair Charge

Hail XL x4,057
Barrage XL x9022`;

describe('EFT parser', () => {
  it('parses one header, duplicate modules, sections, loaded charges, and comma quantities', () => {
    const parsed = parseEftFit(naglfar);
    assert.equal(parsed.header.shipName, 'Naglfar');
    assert.equal(parsed.header.fitName, 'Simulated Naglfar Fitting');
    assert.equal(parsed.lines.filter(line => line.itemName === 'Republic Fleet Gyrostabilizer').length, 2);
    assert.deepEqual(parsed.lines.find(line => line.itemName === 'Armor Command Burst II')?.loadedChargeName, 'Rapid Repair Charge');
    assert.equal(parsed.lines.find(line => line.itemName === 'Hail XL')?.quantity, 4057);
    assert.equal(parsed.sections.length, 3);
  });

  it('rejects multiple headers', () => {
    assert.throws(() => parseEftFit('[Naglfar, A]\\n[Archon, B]'), /one fit at a time/i);
  });

  it('renders normalized EFT with repeated fitted modules and stacked cargo', () => {
    const parsed = parseEftFit(naglfar);
    const rendered = renderEftFit({
      shipName: parsed.header.shipName,
      fitName: parsed.header.fitName,
      lines: parsed.lines,
    });
    assert.match(rendered, /^\\[Naglfar, Simulated Naglfar Fitting\\]/);
    assert.match(rendered, /Hail XL x4057/);
    assert.match(rendered, /Armor Command Burst II, Rapid Repair Charge/);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/fits/parser.test.ts`

Expected: FAIL because `src/fits/parser.ts` does not exist.

- [ ] **Step 3: Implement parser types and parser**

Create `src/fits/types.ts` with shared literal types for section roles, warning codes, slot flags, and parsed line fields. Create `src/fits/parser.ts` with a pure parser that trims blank edges, requires one `[Ship, Fit Name]` header, splits blank-line sections, parses a trailing `xN` quantity with optional thousands comma, splits one loaded charge at the first comma in a non-quantity item line, and preserves raw line/index/section positions.

- [ ] **Step 4: Run parser tests**

Run: `npm test -- src/fits/parser.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/fits/types.ts src/fits/parser.ts src/fits/parser.test.ts
git commit -m "feat: parse EFT fits"
```

## Task 3: Resolve Metadata, Slot Layouts, and Assign Rows

**Files:**
- Create: `src/fits/metadata.ts`
- Create: `src/fits/assignment.ts`
- Create: `src/fits/metadata.test.ts`
- Create: `src/fits/assignment.test.ts`

**Interfaces:**
- Produces:
  - `export interface FitShipLayout`
  - `export function searchFitShips(query: string, limit?: number): FitShipSearchHit[]`
  - `export function resolveShipByName(name: string): FitShip | null`
  - `export function resolveItemByName(name: string): FitItem | null`
  - `export function getShipLayout(shipTypeId: number): FitShipLayout`
  - `export function classifyFitItem(item: FitItem | null): FitItemRole`
  - `export function buildFitDraft(rawEft: string, shipOverrideTypeId?: number): FitDraft`
  - `export function assignFitRows(parsed: ParsedFitText, ship: FitShip | null, layout: FitShipLayout | null): AssignedFit`
- Consumes:
  - `loadMasteryData()` from `src/skills/mastery-data.ts`
  - `.cache/fuzzwork/dgmTypeAttributes.csv`
  - `.cache/fuzzwork/invTypes.csv`, `invGroups.csv`, and `invCategories.csv` where mastery metadata needs a supplement

- [ ] **Step 1: Write failing metadata tests**

Add tests asserting:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getShipLayout, resolveItemByName, resolveShipByName, searchFitShips } from './metadata.ts';

describe('fit metadata', () => {
  it('resolves provided example ships and items', () => {
    assert.equal(resolveShipByName('Naglfar')?.typeId, 19722);
    assert.equal(resolveShipByName('Archon')?.typeId, 23757);
    assert.equal(resolveItemByName('Republic Fleet Gyrostabilizer')?.name, 'Republic Fleet Gyrostabilizer');
    assert.equal(searchFitShips('nag', 5).some(ship => ship.name === 'Naglfar'), true);
  });

  it('reads ship slots from dogma attributes', () => {
    assert.deepEqual(getShipLayout(19722), {
      shipTypeId: 19722,
      shipName: 'Naglfar',
      highSlots: 5,
      midSlots: 7,
      lowSlots: 5,
      rigSlots: 3,
      serviceSlots: 0,
      subsystemSlots: 0,
      warnings: [],
    });
    assert.equal(getShipLayout(35832).serviceSlots, 3);
    assert.equal(getShipLayout(29984).subsystemSlots, 5);
  });
});
```

Use dogma attributes `12` low, `13` mid, `14` high, `1137` rig, `2056` service, and `1367` subsystem.

- [ ] **Step 2: Write failing assignment tests**

Add tests for the Naglfar and Archon sample fits:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFitDraft } from './assignment.ts';

describe('fit assignment', () => {
  it('assigns EFT sections to low, mid, high, rig, and extras with placeholders available', () => {
    const draft = buildFitDraft(`[Naglfar, Simulated Naglfar Fitting]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Tracking Enhancer II
Tracking Enhancer II
Capacitor Power Relay II

Capital Clarity Ward Enduring Shield Booster
Pithum C-Type Multispectrum Shield Hardener

Quad 800mm Repeating Cannon II
Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x4057`);
    assert.equal(draft.ship?.name, 'Naglfar');
    assert.equal(draft.layout?.lowSlots, 5);
    assert.equal(draft.sections.low.items.length, 5);
    assert.equal(draft.sections.mid.items.length, 2);
    assert.equal(draft.sections.high.items.length, 2);
    assert.equal(draft.sections.rig.items.length, 1);
    assert.equal(draft.sections.extras.items.some(item => item.inputName === 'Hail XL'), true);
  });

  it('classifies Archon fighters and drones outside fitting slots', () => {
    const draft = buildFitDraft(`[Archon, Cheap Drones]

Drone Damage Amplifier II

Capital Cap Battery II

Integrated Sensor Array

Capital Thermal Armor Reinforcer I

Equite II x12
Templar II x6`);
    assert.equal(draft.sections.droneBay.items.some(item => item.inputName === 'Equite II'), true);
    assert.equal(draft.sections.fighterBay.items.some(item => item.inputName === 'Templar II'), true);
  });

  it('flags unmatched and over-slot rows without dropping them', () => {
    const draft = buildFitDraft(`[Naglfar, Bad]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Definitely Not A Real Module`);
    assert.equal(draft.warnings.some(w => w.code === 'over-slot'), true);
    assert.equal(draft.warnings.some(w => w.code === 'unmatched-item'), true);
    assert.equal(draft.sections.unmatched.items[0].inputName, 'Definitely Not A Real Module');
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm test -- src/fits/metadata.test.ts src/fits/assignment.test.ts`

Expected: FAIL because metadata and assignment modules do not exist.

- [ ] **Step 4: Implement metadata and assignment**

Implement in small helpers:

```ts
const SLOT_ATTRS = {
  lowSlots: 12,
  midSlots: 13,
  highSlots: 14,
  rigSlots: 1137,
  serviceSlots: 2056,
  subsystemSlots: 1367,
} as const;
```

Use case-insensitive exact name maps for ship and item lookup. Use section order low, mid, high, rig, then extras. Classify drones into `droneBay`, fighters into `fighterBay`, charges/ammo/scripts/deployables/implants/boosters into `extras`, and unknowns into `unmatched`. Preserve every parsed row and every loaded charge as a row with its own role and quantity. Assign ESI flags by section order: `LoSlot0..`, `MedSlot0..`, `HiSlot0..`, `RigSlot0..`, `ServiceSlot0..`, `SubSystemSlot0..`, `DroneBay`, `FighterBay`, or `Cargo`.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/fits/metadata.test.ts src/fits/assignment.test.ts src/fits/parser.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/fits/metadata.ts src/fits/assignment.ts src/fits/metadata.test.ts src/fits/assignment.test.ts
git commit -m "feat: resolve and assign fits"
```

## Task 4: Persist Global Saved Fits

**Files:**
- Create: `src/fits/store.ts`
- Create: `src/fits/store.test.ts`
- Modify: `src/db.ts`

**Interfaces:**
- Produces:
  - `export function migrateFitsDb(database: Database.Database): void`
  - `export function createFitStore(database: Database.Database): FitStore`
  - `FitStore.list(): SavedFitSummary[]`
  - `FitStore.get(id: number): SavedFitDetail | null`
  - `FitStore.create(input: SaveFitInput): SavedFitDetail`
  - `FitStore.update(id: number, input: UpdateFitInput): SavedFitDetail | null`
  - `FitStore.delete(id: number): boolean`
- Consumes:
  - `buildFitDraft` from `src/fits/assignment.ts`

- [ ] **Step 1: Write failing store tests**

Add `src/fits/store.test.ts` with an in-memory better-sqlite3 database. Verify migration creates `saved_fits` and `saved_fit_items`, create/list/get/update/delete works, manual save stores rows produced by `buildFitDraft`, updated fit name and notes change `updatedAt`, and delete cascades item rows.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/fits/store.test.ts`

Expected: FAIL because `src/fits/store.ts` does not exist.

- [ ] **Step 3: Implement migration and CRUD**

Create `saved_fits` and `saved_fit_items` using the schema in the design spec, add indexes on `updated_at`, `ship_name`, and `fit_id`, and map database rows back into the same normalized `FitDraft`/detail shape used by preview. Use `Date.now()` once per write.

- [ ] **Step 4: Register migration**

Modify `src/db.ts`:

```ts
import { migrateFitsDb } from './fits/store.ts';
```

and call:

```ts
migrateFitsDb(db);
```

after `migrateContractIndexDb(db)`.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/fits/store.test.ts src/fits/assignment.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/fits/store.ts src/fits/store.test.ts src/db.ts
git commit -m "feat: persist saved fits"
```

## Task 5: Price Fits and Build ESI Payloads

**Files:**
- Create: `src/fits/pricing.ts`
- Create: `src/fits/pricing.test.ts`
- Create: `src/fits/esi.ts`
- Create: `src/fits/esi.test.ts`
- Modify: `src/auth/scopes.ts`

**Interfaces:**
- Produces:
  - `export async function quoteFit(fit: FitDetailLike, hub: HubKey, deps?: FitPricingDeps): Promise<FitQuote>`
  - `export function buildEsiFittingPayload(fit: FitDetailLike): EsiFittingCreatePayload`
  - `export async function createCharacterFitting(characterId: number, payload: EsiFittingCreatePayload): Promise<number | null>`
- Consumes:
  - `quoteResolvedMarketItems` from `src/market/pricing.ts`
  - `esiPost` from `src/esi/client.ts`

- [ ] **Step 1: Write failing pricing tests**

Add tests that build a small fit detail and inject a fake quote dependency returning deterministic row costs. Assert hull, fitted, extras, and grand totals are separated; unmatched rows are omitted; row statuses are preserved.

- [ ] **Step 2: Write failing ESI tests**

Add tests asserting a Naglfar fit payload has `ship_type_id`, `LoSlot0`, `MedSlot0`, `HiSlot0`, `RigSlot0`, `Cargo`, excludes unmatched rows, truncates `name` to ESI-safe length, and throws a clear error if more than 512 exportable rows are present.

- [ ] **Step 3: Run tests to verify RED**

Run: `npm test -- src/fits/pricing.test.ts src/fits/esi.test.ts`

Expected: FAIL because `src/fits/pricing.ts` and `src/fits/esi.ts` do not exist.

- [ ] **Step 4: Implement pricing and ESI payload builder**

Implement `quoteFit` by sending the hull as bucket `hull`, fitted slot rows as bucket `fitted`, and extras/drones/fighters/cargo as bucket `extras`. Implement `buildEsiFittingPayload` with allowed flags from the design spec and quantity stacks for Cargo/DroneBay/FighterBay while slot flags use quantity `1` per occupied module row.

- [ ] **Step 5: Add fitting scope**

Modify `src/auth/scopes.ts` to include:

```ts
'esi-fittings.write_fittings.v1',
```

- [ ] **Step 6: Run tests**

Run: `npm test -- src/fits/pricing.test.ts src/fits/esi.test.ts src/market/pricing.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/fits/pricing.ts src/fits/pricing.test.ts src/fits/esi.ts src/fits/esi.test.ts src/auth/scopes.ts
git commit -m "feat: price and export fittings"
```

## Task 6: Add Fits API Routes

**Files:**
- Create: `src/routes/fits.ts`
- Create: `src/routes/fits.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Produces endpoints:
  - `GET /api/fits`
  - `GET /api/fits/:id`
  - `POST /api/fits/preview`
  - `POST /api/fits`
  - `PUT /api/fits/:id`
  - `DELETE /api/fits/:id`
  - `GET /api/fits/ships?q=<query>`
  - `POST /api/fits/:id/quote`
  - `POST /api/fits/quote-draft`
  - `POST /api/fits/:id/send`
  - `POST /api/fits/send-draft`
- Consumes:
  - `createFitStore(db)` from `src/fits/store.ts`
  - `buildFitDraft` from `src/fits/assignment.ts`
  - `quoteFit` from `src/fits/pricing.ts`
  - `buildEsiFittingPayload` and `createCharacterFitting` from `src/fits/esi.ts`

- [ ] **Step 1: Write failing route tests**

Add `src/routes/fits.test.ts` using `Fastify()` and an in-memory store dependency. Cover preview warnings for unmatched rows, save/list/get/update/delete, quote totals with a fake pricing dependency, send missing-scope reauth hint on 403, and successful send returning fitting ID.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/routes/fits.test.ts`

Expected: FAIL because `src/routes/fits.ts` does not exist.

- [ ] **Step 3: Implement routes**

Implement a `registerFitRoutes(app, deps?)` function so tests can inject store, pricing, and ESI dependencies. Validate hub as `jita` or `amarr`, validate numeric IDs, return `400` for missing EFT/body fields, return `404` for missing saved fit, and return `403` with `reauthHint` when the ESI error status is `403` or the body mentions `esi-fittings.write_fittings.v1`.

- [ ] **Step 4: Register routes in server**

Modify `src/server.ts`:

```ts
import { registerFitRoutes } from './routes/fits.ts';
```

and call:

```ts
registerFitRoutes(app);
```

near the other dashboard route registrations.

- [ ] **Step 5: Run route tests**

Run: `npm test -- src/routes/fits.test.ts src/fits/store.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/routes/fits.ts src/routes/fits.test.ts src/server.ts
git commit -m "feat: add fits API"
```

## Task 7: Build the Fits React View

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/FitsView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ControlPanel.tsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes:
  - Fits API endpoints from Task 6
  - `CharacterStatus[]` from `App`
- Produces:
  - New `fits` top-level app view
  - In-memory draft preview
  - Manual save/update/delete
  - Copy EFT
  - Pilot dropdown and send-to-pilot action

- [ ] **Step 1: Add API types and helpers**

In `web/src/api.ts`, add TypeScript interfaces mirroring route responses and helpers: `fetchFits`, `fetchFit`, `previewFit`, `saveFit`, `updateFit`, `deleteFit`, `searchFitShips`, `quoteSavedFit`, `quoteDraftFit`, `sendSavedFit`, and `sendDraftFit`. Each helper returns `{ error: string }` on non-OK responses, matching existing app conventions.

- [ ] **Step 2: Create FitsView**

Implement `FitsView` with these stable state keys:

```ts
const FITS_HUB_KEY = 'efd.fits.hub';
const FITS_PILOT_KEY = 'efd.fits.pilot';
```

Render a left library, hub selector, import button, right detail panel, import modal, unmatched alert modal, warning badges, slot icon grids, price summary, save controls, delete confirmation, copy button, and send controls. Use `<img src={iconUrl}>` for resolved items and the `title` attribute plus CSS hover tooltip text for item names.

- [ ] **Step 3: Wire navigation**

Modify `App.tsx` and `ControlPanel.tsx` view unions to include `'fits'`, render `<FitsView chars={list} />`, and add a Fits button to the view nav.

- [ ] **Step 4: Add CSS**

Add dense dark Fits styles in `web/src/styles.css`: two-column fit workspace, 300px library, responsive single-column fallback, compact slot cells with fixed dimensions, dashed empty placeholders, icon tooltips, warning badges, pricing summary, modal overlay, and buttons consistent with existing dashboard controls.

- [ ] **Step 5: Run build verification**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add web/src/api.ts web/src/components/FitsView.tsx web/src/App.tsx web/src/components/ControlPanel.tsx web/src/styles.css
git commit -m "feat: add fits dashboard UI"
```

## Task 8: Full Verification and Local Run

**Files:**
- No source files unless verification exposes a bug.

**Interfaces:**
- Consumes completed Tasks 1-7.
- Produces a locally runnable Fits dashboard and a concise verification report.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Start local app**

Run: `npm run dev`

Expected: server listens on `http://127.0.0.1:3100` and Vite listens on `http://localhost:5173`.

- [ ] **Step 3: Browser smoke**

Open `http://localhost:5173`, select Fits, import the Naglfar sample from the design spec, confirm unmatched modal behavior when adding one bogus item, confirm icon grids and empty placeholders render, save manually, refresh page, confirm saved fit persists and draft does not, copy EFT, and quote at Jita.

- [ ] **Step 4: Commit verification fixes**

If verification exposes a bug, fix it with a failing test first, rerun the relevant command, then commit with a specific message such as:

```bash
git add <changed-files>
git commit -m "fix: correct fits quote refresh"
```

## Self-Review

- Spec coverage: Tasks cover shared market reuse, parser, metadata, slot placeholders, assignment warnings, persistence, pricing totals, ESI fitting export, API, React UI, copy EFT, manual save, unmatched modal, and local verification.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or unspecified edge handling remains in this plan.
- Type consistency: route, store, pricing, and UI tasks all consume the same `FitDraft`/detail shapes defined in Tasks 2-3, and market quote helpers are produced before fit pricing consumes them.
