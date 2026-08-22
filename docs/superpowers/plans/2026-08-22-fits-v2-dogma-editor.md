# Fits v2 Dogma Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `Fits v2` fitting simulator under the existing Fits section where users can create, edit, simulate, price, save, export, and send ship fits.

**Architecture:** Keep the current Fits and Doctrines views stable while adding a sibling `Fits v2` mode. Store a new editor-native fit payload beside the existing saved-fit EFT fields, and bridge between old saved fits and the new editor with explicit conversion utilities. Add dogma/stat support incrementally: editor foundation first, basic fitting validation next, then deeper pilot/All V dogma calculations.

**Tech Stack:** Fastify, TypeScript, React 18, Vite, SQLite compatibility store, Postgres runtime store, bundled Fuzzwork/SDE data, existing saved-fit/pricing/ESI APIs.

**Spec:** `docs/superpowers/specs/2026-08-22-fits-v2-dogma-editor-design.md`

## Global Constraints

- Do not remove or rewrite the existing Fits and Doctrines views.
- Do not make autosave the default behavior. Saving remains manual.
- Existing saved fits must open in `Fits v2` through best-effort conversion.
- Do not make EVEShipFit's public Next.js site a runtime dependency.
- `Fits v2` editing and saving require login because pilot skills and persistence are account-scoped.
- Use an editor-native model with `shipTypeId`, modules by slot, module state, charges, drones, and cargo.
- Extend saved fits with optional `editor_json` and `editor_version` while keeping `raw_eft` and parsed rows compatible with the old view.
- Skill profiles must include `All V` and authenticated pilots using cached ESI skill data.
- Ship incrementally behind `/fits/v2`; old Fits remains the fallback.

---

## File Structure

### Shared Types And Conversion

- Create `src/fits-v2/types.ts`: server-side editor model and warning/stat DTO types.
- Create `src/fits-v2/schema.ts`: runtime validation for editor payloads.
- Create `src/fits-v2/conversion.ts`: editor-to-EFT and saved-detail-to-editor conversion helpers.
- Create `src/fits-v2/catalog.ts`: compact catalog functions backed by existing metadata/SDE cache.
- Create `src/fits-v2/simulation.ts`: phase 1/2 simulation helpers for All V profile and basic fitting validation.
- Create `src/fits-v2/skill-profile.ts`: profile resolution contracts and All V/pilot profile DTOs.

### Backend Persistence And Routes

- Modify `src/fits/store.ts`: add `editorJson` and `editorVersion` to inputs/details and both SQLite/Postgres mapping.
- Modify migration files under `src/db/migrations.ts` or the current migration module used for Postgres: add nullable `editor_json` and non-null `editor_version` defaulting to `1`.
- Modify `src/routes/fits.ts`: accept `editorJson`, return it on fit detail, and expose v2 catalog/simulate endpoints.
- Modify `src/routes/fits.test.ts`: add route coverage for editor payload persistence, validation, catalog, and simulate.
- Add `src/fits-v2/*.test.ts`: model validation, conversion, catalog, and simulation tests.

### Frontend API And Routing

- Modify `web/src/app-routes.ts`: add `mode: 'v2'`, parse `/fits/v2` and `/fits/v2/:id`, and generate those paths.
- Modify `web/src/components/FitModeSwitch.tsx`: add `Fits v2`.
- Modify `web/src/components/FitsView.tsx`: mount `FitsV2View` for v2 mode and preserve existing mode behavior.
- Modify `web/src/api.ts`: add v2 types and helpers for catalog, simulate, editor save/update fields.
- Modify routing tests: `src/app-routing.test.ts`, `src/app-routing-view.test.ts`, and any static view tests that assert fit modes.

### Frontend Fits v2 View

- Create `web/src/fits-v2/types.ts`: frontend mirror of the editor model and UI state.
- Create `web/src/fits-v2/FitsV2View.tsx`: top-level view shell and orchestration.
- Create `web/src/fits-v2/FitsV2Provider.tsx`: current fit, dirty state, selected skill profile, selected saved fit.
- Create `web/src/fits-v2/fitV2Conversion.ts`: frontend conversion helpers when needed for UI-only operations.
- Create `web/src/fits-v2/HullBrowser.tsx`: hull and saved-fit picker.
- Create `web/src/fits-v2/HardwareBrowser.tsx`: module/charge/drone/cargo search and filters.
- Create `web/src/fits-v2/FittingRing.tsx`: central in-game-style fitting surface.
- Create `web/src/fits-v2/FitSlot.tsx`: slot rendering and slot actions.
- Create `web/src/fits-v2/DroneCargoPanel.tsx`: drones and cargo editing.
- Create `web/src/fits-v2/SkillProfileSelector.tsx`: All V/pilot profile selector.
- Create `web/src/fits-v2/StatsPanel.tsx`: stats and validation warnings.
- Create `web/src/fits-v2/FitV2Actions.tsx`: save, export EFT, price, send.
- Modify `web/src/styles.css`: add scoped `.fits-v2-*` styles.

---

## Milestone 1: Routing, Store Support, And Editor Model

### Task 1: Add Fits v2 editor model and schema

**Files:**
- Create: `src/fits-v2/types.ts`
- Create: `src/fits-v2/schema.ts`
- Test: `src/fits-v2/schema.test.ts`

**Interfaces:**
- Produces:
  - `FitV2ModuleState = 'offline' | 'online' | 'active' | 'overheated'`
  - `FitV2SlotType = 'high' | 'mid' | 'low' | 'rig' | 'subsystem' | 'service'`
  - `FitV2Fit`
  - `validateFitV2Fit(input: unknown): FitV2Fit`
  - `isFitV2Fit(input: unknown): input is FitV2Fit`
- Consumes: none.

- [ ] **Step 1: Write failing schema tests**

Create `src/fits-v2/schema.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { isFitV2Fit, validateFitV2Fit } from './schema.ts';

const validFit = {
  name: 'Brawl Raven',
  notes: 'test fit',
  shipTypeId: 638,
  modules: [
    { typeId: 2048, slot: { type: 'high', index: 1 }, state: 'active', chargeTypeId: 2456 },
    { typeId: 2281, slot: { type: 'mid', index: 1 }, state: 'online' },
  ],
  drones: [{ typeId: 2486, active: 5, passive: 0 }],
  cargo: [{ typeId: 2456, quantity: 1000 }],
};

test('validateFitV2Fit accepts a complete editor fit', () => {
  assert.deepEqual(validateFitV2Fit(validFit), validFit);
  assert.equal(isFitV2Fit(validFit), true);
});

test('validateFitV2Fit rejects invalid module states and slot types', () => {
  assert.throws(() => validateFitV2Fit({ ...validFit, modules: [{ typeId: 1, slot: { type: 'weird', index: 1 }, state: 'active' }] }), /invalid/i);
  assert.throws(() => validateFitV2Fit({ ...validFit, modules: [{ typeId: 1, slot: { type: 'high', index: 1 }, state: 'warm' }] }), /invalid/i);
});

test('validateFitV2Fit rejects empty names, invalid ids, and invalid quantities', () => {
  assert.throws(() => validateFitV2Fit({ ...validFit, name: '' }), /name/i);
  assert.throws(() => validateFitV2Fit({ ...validFit, shipTypeId: 0 }), /shipTypeId/i);
  assert.throws(() => validateFitV2Fit({ ...validFit, cargo: [{ typeId: 2456, quantity: 0 }] }), /quantity/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/fits-v2/schema.test.ts
```

Expected: FAIL because `src/fits-v2/schema.ts` does not exist.

- [ ] **Step 3: Implement types**

Create `src/fits-v2/types.ts`:

```ts
export type FitV2ModuleState = 'offline' | 'online' | 'active' | 'overheated';
export type FitV2SlotType = 'high' | 'mid' | 'low' | 'rig' | 'subsystem' | 'service';

export interface FitV2Slot {
  type: FitV2SlotType;
  index: number;
}

export interface FitV2Module {
  typeId: number;
  slot: FitV2Slot;
  state: FitV2ModuleState;
  chargeTypeId?: number;
}

export interface FitV2CargoItem {
  typeId: number;
  quantity: number;
}

export interface FitV2DroneItem {
  typeId: number;
  active: number;
  passive: number;
}

export interface FitV2Fit {
  name: string;
  notes: string;
  shipTypeId: number;
  modules: FitV2Module[];
  drones: FitV2DroneItem[];
  cargo: FitV2CargoItem[];
}

export interface FitV2Warning {
  code: string;
  message: string;
  typeId?: number;
  slot?: FitV2Slot;
}
```

- [ ] **Step 4: Implement schema validation**

Create `src/fits-v2/schema.ts`:

```ts
import type { FitV2Fit, FitV2ModuleState, FitV2SlotType } from './types.ts';

const SLOT_TYPES = new Set<FitV2SlotType>(['high', 'mid', 'low', 'rig', 'subsystem', 'service']);
const MODULE_STATES = new Set<FitV2ModuleState>(['offline', 'online', 'active', 'overheated']);

export function isFitV2Fit(input: unknown): input is FitV2Fit {
  try {
    validateFitV2Fit(input);
    return true;
  } catch {
    return false;
  }
}

export function validateFitV2Fit(input: unknown): FitV2Fit {
  if (!isRecord(input)) throw new Error('invalid fit payload');
  const name = cleanString(input.name, 'name');
  const notes = typeof input.notes === 'string' ? input.notes : '';
  const shipTypeId = cleanPositiveInteger(input.shipTypeId, 'shipTypeId');
  const modules = expectArray(input.modules, 'modules').map((module, index) => {
    if (!isRecord(module)) throw new Error(`invalid module at ${index}`);
    const slot = module.slot;
    if (!isRecord(slot)) throw new Error(`invalid module slot at ${index}`);
    const type = slot.type;
    if (typeof type !== 'string' || !SLOT_TYPES.has(type as FitV2SlotType)) throw new Error(`invalid slot type at ${index}`);
    const state = module.state;
    if (typeof state !== 'string' || !MODULE_STATES.has(state as FitV2ModuleState)) throw new Error(`invalid module state at ${index}`);
    return {
      typeId: cleanPositiveInteger(module.typeId, `modules[${index}].typeId`),
      slot: { type: type as FitV2SlotType, index: cleanPositiveInteger(slot.index, `modules[${index}].slot.index`) },
      state: state as FitV2ModuleState,
      ...(module.chargeTypeId == null ? {} : { chargeTypeId: cleanPositiveInteger(module.chargeTypeId, `modules[${index}].chargeTypeId`) }),
    };
  });
  const drones = expectArray(input.drones, 'drones').map((drone, index) => {
    if (!isRecord(drone)) throw new Error(`invalid drone at ${index}`);
    return {
      typeId: cleanPositiveInteger(drone.typeId, `drones[${index}].typeId`),
      active: cleanNonNegativeInteger(drone.active, `drones[${index}].active`),
      passive: cleanNonNegativeInteger(drone.passive, `drones[${index}].passive`),
    };
  });
  const cargo = expectArray(input.cargo, 'cargo').map((item, index) => {
    if (!isRecord(item)) throw new Error(`invalid cargo item at ${index}`);
    return {
      typeId: cleanPositiveInteger(item.typeId, `cargo[${index}].typeId`),
      quantity: cleanPositiveInteger(item.quantity, `cargo[${index}].quantity`),
    };
  });
  return { name, notes, shipTypeId, modules, drones, cargo };
}

function cleanString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function cleanPositiveInteger(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer`);
  return n;
}

function cleanNonNegativeInteger(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return n;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
```

- [ ] **Step 5: Verify test passes**

Run:

```bash
npm test -- src/fits-v2/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fits-v2/types.ts src/fits-v2/schema.ts src/fits-v2/schema.test.ts
git commit -m "Add Fits v2 editor model"
```

### Task 2: Persist editor payloads in saved fits

**Files:**
- Modify: `src/fits/store.ts`
- Modify: `src/routes/fits.ts`
- Modify: `src/routes/fits.test.ts`
- Modify: `src/db/migrations.ts` or the Postgres migration module that owns `saved_fits`
- Test: `src/routes/fits.test.ts`

**Interfaces:**
- Consumes: `validateFitV2Fit(input: unknown): FitV2Fit`
- Produces:
  - `SaveFitInput.editorJson?: FitV2Fit | null`
  - `UpdateFitInput.editorJson?: FitV2Fit | null`
  - `SavedFitDetail.editorJson: FitV2Fit | null`
  - `SavedFitDetail.editorVersion: number`

- [ ] **Step 1: Write failing route tests for editor payload persistence**

Append to `src/routes/fits.test.ts`:

```ts
test('fit routes persist optional Fits v2 editor payloads', async () => {
  const { app } = createFitRoutesTestApp({ currentUser: { id: 'user-a', email: 'a@example.com', role: 'user' } });
  const editorJson = {
    name: 'V2 Raven',
    notes: 'manual editor payload',
    shipTypeId: 638,
    modules: [{ typeId: 2048, slot: { type: 'high', index: 1 }, state: 'active' }],
    drones: [],
    cargo: [{ typeId: 2456, quantity: 100 }],
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/fits',
    payload: {
      rawEft: '[Raven, V2 Raven]\\nCruise Missile Launcher I\\n\\nScourge Cruise Missile x100',
      editorJson,
    },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json();
  assert.deepEqual(body.editorJson, editorJson);
  assert.equal(body.editorVersion, 1);

  const updatedEditorJson = { ...editorJson, name: 'V2 Raven Updated', modules: [] };
  const updated = await app.inject({
    method: 'PUT',
    url: `/api/fits/${body.id}`,
    payload: { rawEft: '[Raven, V2 Raven Updated]', editorJson: updatedEditorJson },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.json().editorJson, updatedEditorJson);

  const got = await app.inject({ method: 'GET', url: `/api/fits/${body.id}` });
  assert.deepEqual(got.json().editorJson, updatedEditorJson);
});

test('fit routes reject invalid Fits v2 editor payloads', async () => {
  const { app } = createFitRoutesTestApp({ currentUser: { id: 'user-a', email: 'a@example.com', role: 'user' } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/fits',
    payload: {
      rawEft: '[Raven, Bad V2]',
      editorJson: { name: '', shipTypeId: 0, modules: [], drones: [], cargo: [] },
    },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /name|shipTypeId|editor/i);
});
```

If `createFitRoutesTestApp` has a different helper name, use the existing helper in `src/routes/fits.test.ts` and keep the assertions unchanged.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/routes/fits.test.ts
```

Expected: FAIL because editor fields are not accepted or returned.

- [ ] **Step 3: Extend store interfaces and row mapping**

Modify `src/fits/store.ts`:

```ts
import { validateFitV2Fit, type FitV2Fit } from '../fits-v2/schema.ts';
```

If `type FitV2Fit` is exported only from `types.ts`, import it from there:

```ts
import type { FitV2Fit } from '../fits-v2/types.ts';
```

Add to `SaveFitInput` and `UpdateFitInput`:

```ts
editorJson?: FitV2Fit | null;
```

Add to `SavedFitDetail`:

```ts
editorJson: FitV2Fit | null;
editorVersion: number;
```

Add row columns:

```ts
editor_json: string | null;
editor_version: number | string;
```

In SQLite migration, include:

```sql
editor_json TEXT,
editor_version INTEGER NOT NULL DEFAULT 1,
```

and after `PRAGMA table_info(saved_fits)`:

```ts
if (!columns.some(col => col.name === 'editor_json')) database.prepare('ALTER TABLE saved_fits ADD COLUMN editor_json TEXT').run();
if (!columns.some(col => col.name === 'editor_version')) database.prepare('ALTER TABLE saved_fits ADD COLUMN editor_version INTEGER NOT NULL DEFAULT 1').run();
```

- [ ] **Step 4: Store editor JSON during create/update**

Update insert/update SQL to include:

```sql
editor_json, editor_version
```

Use helpers:

```ts
function serializeEditorJson(editorJson: FitV2Fit | null | undefined): string | null {
  if (editorJson == null) return null;
  return JSON.stringify(validateFitV2Fit(editorJson));
}

function parseEditorJson(raw: unknown): FitV2Fit | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return validateFitV2Fit(JSON.parse(raw));
}
```

Set `editorVersion` to `1` for now.

- [ ] **Step 5: Extend Postgres migration and Postgres store**

Find the Postgres migration that creates/alters `saved_fits`. Add:

```sql
ALTER TABLE saved_fits ADD COLUMN IF NOT EXISTS editor_json TEXT;
ALTER TABLE saved_fits ADD COLUMN IF NOT EXISTS editor_version INTEGER NOT NULL DEFAULT 1;
```

Update Postgres insert/update/select mapping the same way as SQLite.

- [ ] **Step 6: Validate editor payloads in routes**

Modify `src/routes/fits.ts` create and update body types:

```ts
editorJson?: unknown;
```

Before passing to the store:

```ts
const editorJson = body?.editorJson == null ? undefined : validateFitV2Fit(body.editorJson);
```

Return `400` on validation errors using existing `errorMessage()`.

- [ ] **Step 7: Verify tests**

Run:

```bash
npm test -- src/routes/fits.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/fits/store.ts src/routes/fits.ts src/routes/fits.test.ts src/db/migrations.ts src/fits-v2/schema.ts src/fits-v2/types.ts
git commit -m "Persist Fits v2 editor payloads"
```

### Task 3: Add Fits v2 routing and mode switch shell

**Files:**
- Modify: `web/src/app-routes.ts`
- Modify: `web/src/components/FitModeSwitch.tsx`
- Modify: `web/src/components/FitsView.tsx`
- Create: `web/src/fits-v2/FitsV2View.tsx`
- Test: `src/app-routing.test.ts`
- Test: `src/fits/fits-v2-view.test.ts`

**Interfaces:**
- Consumes: existing `FitModeSwitch`, `FitsView`
- Produces:
  - `FitMode = 'fits' | 'doctrines' | 'v2'`
  - `/fits/v2` and `/fits/v2/:id` route support
  - `FitsV2View` props:

```ts
interface FitsV2ViewProps {
  chars: CharacterStatus[];
  currentUser?: CurrentUser | null;
  visibility: LibraryVisibility;
  routeFitId: number | null;
  onOpenFitRoute: (id: number) => void;
}
```

- [ ] **Step 1: Write failing routing tests**

Modify `src/app-routing.test.ts`:

```ts
assert.deepEqual(parseAppRoute('/fits/v2'), { view: 'fits', mode: 'v2' });
assert.deepEqual(parseAppRoute('/fits/v2/42'), { view: 'fits', mode: 'v2', fitId: 42 });
assert.equal(pathForRoute({ view: 'fits', mode: 'v2' }), '/fits/v2');
assert.equal(pathForRoute({ view: 'fits', mode: 'v2', fitId: 42 }), '/fits/v2/42');
```

Create `src/fits/fits-v2-view.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Fits v2 is exposed as a sibling mode without replacing old fits', () => {
  const switchSource = readFileSync(resolve('web/src/components/FitModeSwitch.tsx'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const appRoutes = readFileSync(resolve('web/src/app-routes.ts'), 'utf8');
  assert.match(switchSource, /Fits v2/);
  assert.match(switchSource, /onMode\\('v2'\\)/);
  assert.match(fitsView, /FitsV2View/);
  assert.match(fitsView, /mode === 'v2'/);
  assert.match(appRoutes, /fits\\/v2/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/app-routing.test.ts src/fits/fits-v2-view.test.ts
```

Expected: FAIL because v2 route and view do not exist.

- [ ] **Step 3: Update route types**

Modify `web/src/app-routes.ts`:

```ts
export type FitRouteMode = 'fits' | 'doctrines' | 'v2';
```

Change the fits route shape:

```ts
| { view: 'fits'; mode?: FitRouteMode; fitId?: number; doctrineId?: number };
```

Add parser cases before the existing `fit` route:

```ts
if (first === 'fits' && second === 'v2') {
  const id = numericId(parts[2]);
  return id != null ? { view: 'fits', mode: 'v2', fitId: id } : { view: 'fits', mode: 'v2' };
}
```

Update `pathForRoute`:

```ts
if (route.mode === 'v2') return route.fitId != null ? `/fits/v2/${route.fitId}` : '/fits/v2';
```

- [ ] **Step 4: Add mode switch button**

Modify `web/src/components/FitModeSwitch.tsx`:

```ts
export type FitMode = 'fits' | 'doctrines' | 'v2';
```

Add a third button:

```tsx
<button className={mode === 'v2' ? 'active' : ''} onClick={() => onMode('v2')} role="tab" aria-selected={mode === 'v2'}>
  Fits v2
</button>
```

- [ ] **Step 5: Create a placeholder Fits v2 view**

Create `web/src/fits-v2/FitsV2View.tsx`:

```tsx
import type { CharacterStatus, CurrentUser, LibraryVisibility } from '../api.ts';

interface FitsV2ViewProps {
  chars: CharacterStatus[];
  currentUser?: CurrentUser | null;
  visibility: LibraryVisibility;
  routeFitId: number | null;
  onOpenFitRoute: (id: number) => void;
}

export function FitsV2View({ currentUser, routeFitId }: FitsV2ViewProps) {
  return (
    <section className="fits-v2-view" aria-label="Fits v2 editor">
      <div className="fits-v2-empty">
        <h2>Fits v2</h2>
        <p>{currentUser ? 'Choose a hull or open a saved fit to start editing.' : 'Log in to create and edit Fits v2 fittings.'}</p>
        {routeFitId != null && <p>Opening saved fit #{routeFitId}.</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Mount FitsV2View**

Modify `web/src/components/FitsView.tsx`:

```ts
import { FitsV2View } from '../fits-v2/FitsV2View.tsx';
```

In the render branch:

```tsx
{mode === 'v2'
  ? <FitsV2View chars={chars} currentUser={currentUser} visibility={effectiveVisibility} routeFitId={routeFitId} onOpenFitRoute={onOpenFitRoute} />
  : mode === 'doctrines'
    ? <DoctrinesView ... />
    : <SavedFitsView ... />}
```

Update `onOpenFitRoute` for v2 later in Task 8; for now the placeholder can accept it.

- [ ] **Step 7: Add minimal styles**

Modify `web/src/styles.css`:

```css
.fits-v2-view {
  min-height: 60vh;
}
.fits-v2-empty {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 6px;
  padding: 24px;
}
```

- [ ] **Step 8: Verify tests**

Run:

```bash
npm test -- src/app-routing.test.ts src/fits/fits-v2-view.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/app-routes.ts web/src/components/FitModeSwitch.tsx web/src/components/FitsView.tsx web/src/fits-v2/FitsV2View.tsx web/src/styles.css src/app-routing.test.ts src/fits/fits-v2-view.test.ts
git commit -m "Add Fits v2 route shell"
```

## Milestone 2: Conversion, Catalog, And Save Loop

### Task 4: Convert editor fits to EFT and old saved fits to editor fits

**Files:**
- Create: `src/fits-v2/conversion.ts`
- Test: `src/fits-v2/conversion.test.ts`
- Modify: `web/src/api.ts`

**Interfaces:**
- Consumes: `FitV2Fit`, `SavedFitDetail`, `resolveItemByTypeId`, `resolveShipByTypeId`
- Produces:
  - `fitV2ToEft(fit: FitV2Fit): string`
  - `savedFitDetailToFitV2(detail: SavedFitDetail): { fit: FitV2Fit; warnings: FitV2Warning[] }`
  - `fitV2ToRawEftAndMetadata(fit: FitV2Fit): { rawEft: string; shipTypeId: number; fitName: string; notes: string }`

- [ ] **Step 1: Write failing conversion tests**

Create `src/fits-v2/conversion.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitV2ToEft, fitV2ToRawEftAndMetadata } from './conversion.ts';

test('fitV2ToEft exports hull header, modules, charges, drones, and cargo', () => {
  const eft = fitV2ToEft({
    name: 'Cruise Test',
    notes: '',
    shipTypeId: 638,
    modules: [
      { typeId: 2048, slot: { type: 'high', index: 1 }, state: 'active', chargeTypeId: 2456 },
      { typeId: 2281, slot: { type: 'mid', index: 1 }, state: 'online' },
    ],
    drones: [{ typeId: 2486, active: 2, passive: 3 }],
    cargo: [{ typeId: 2456, quantity: 1000 }],
  });
  assert.match(eft, /^\\[Raven, Cruise Test\\]/);
  assert.match(eft, /Cruise Missile Launcher I, Scourge Cruise Missile/);
  assert.match(eft, /Adaptive Invulnerability Field I/);
  assert.match(eft, /Hobgoblin I x5/);
  assert.match(eft, /Scourge Cruise Missile x1000/);
});

test('fitV2ToRawEftAndMetadata returns fields accepted by existing save routes', () => {
  const result = fitV2ToRawEftAndMetadata({
    name: 'Cruise Test',
    notes: 'note',
    shipTypeId: 638,
    modules: [],
    drones: [],
    cargo: [],
  });
  assert.equal(result.shipTypeId, 638);
  assert.equal(result.fitName, 'Cruise Test');
  assert.equal(result.notes, 'note');
  assert.match(result.rawEft, /^\\[Raven, Cruise Test\\]/);
});
```

If type IDs in this sample differ in the current metadata cache, adjust them to known published test items from `.cache/fuzzwork/invTypes.csv` before implementing.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/fits-v2/conversion.test.ts
```

Expected: FAIL because conversion does not exist.

- [ ] **Step 3: Implement EFT export**

Create `src/fits-v2/conversion.ts` with:

```ts
import { resolveItemByTypeId, resolveShipByTypeId } from '../fits/metadata.ts';
import type { SavedFitDetail } from '../fits/store.ts';
import type { AssignedFitItem, FitSectionRole } from '../fits/types.ts';
import type { FitV2Fit, FitV2Module, FitV2SlotType, FitV2Warning } from './types.ts';

const SLOT_ORDER: FitV2SlotType[] = ['low', 'mid', 'high', 'rig', 'subsystem', 'service'];
const ROLE_TO_SLOT: Partial<Record<FitSectionRole, FitV2SlotType>> = {
  low: 'low',
  mid: 'mid',
  high: 'high',
  rig: 'rig',
  subsystem: 'subsystem',
  service: 'service',
};

export function fitV2ToRawEftAndMetadata(fit: FitV2Fit) {
  return {
    rawEft: fitV2ToEft(fit),
    shipTypeId: fit.shipTypeId,
    fitName: fit.name,
    notes: fit.notes,
  };
}

export function fitV2ToEft(fit: FitV2Fit): string {
  const ship = resolveShipByTypeId(fit.shipTypeId);
  const lines: string[] = [`[${ship?.name ?? `Type ${fit.shipTypeId}`}, ${fit.name}]`];
  for (const slotType of SLOT_ORDER) {
    const modules = fit.modules
      .filter(module => module.slot.type === slotType)
      .sort((a, b) => a.slot.index - b.slot.index);
    if (modules.length === 0) continue;
    lines.push('');
    for (const module of modules) lines.push(formatModule(module));
  }
  const droneLines = fit.drones
    .map(drone => ({ name: nameForType(drone.typeId), quantity: drone.active + drone.passive }))
    .filter(row => row.quantity > 0)
    .map(row => `${row.name} x${row.quantity}`);
  if (droneLines.length > 0) lines.push('', ...droneLines);
  const cargoLines = fit.cargo
    .filter(item => item.quantity > 0)
    .map(item => `${nameForType(item.typeId)} x${item.quantity}`);
  if (cargoLines.length > 0) lines.push('', ...cargoLines);
  return `${lines.join('\n')}\n`;
}

export function savedFitDetailToFitV2(detail: SavedFitDetail): { fit: FitV2Fit; warnings: FitV2Warning[] } {
  if (detail.editorJson) return { fit: detail.editorJson, warnings: [] };
  const warnings: FitV2Warning[] = [];
  const modules: FitV2Module[] = [];
  const slotIndexes: Record<FitV2SlotType, number> = { high: 1, mid: 1, low: 1, rig: 1, subsystem: 1, service: 1 };
  const drones = new Map<number, { typeId: number; active: number; passive: number }>();
  const cargo = new Map<number, { typeId: number; quantity: number }>();
  for (const item of detail.items) {
    if (item.typeId == null) {
      warnings.push({ code: 'unmatched-item', message: `Unmatched item: ${item.inputName}` });
      continue;
    }
    const slotType = ROLE_TO_SLOT[item.role];
    if (slotType) {
      modules.push({
        typeId: item.typeId,
        slot: { type: slotType, index: slotIndexes[slotType]++ },
        state: 'active',
      });
      continue;
    }
    if (item.role === 'droneBay' || item.role === 'fighterBay') {
      const row = drones.get(item.typeId) ?? { typeId: item.typeId, active: 0, passive: 0 };
      row.passive += item.quantity;
      drones.set(item.typeId, row);
      continue;
    }
    const row = cargo.get(item.typeId) ?? { typeId: item.typeId, quantity: 0 };
    row.quantity += item.quantity;
    cargo.set(item.typeId, row);
  }
  return {
    fit: {
      name: detail.fitName,
      notes: detail.notes,
      shipTypeId: detail.ship.typeId,
      modules,
      drones: [...drones.values()],
      cargo: [...cargo.values()],
    },
    warnings,
  };
}

function formatModule(module: FitV2Module): string {
  const base = nameForType(module.typeId);
  const charge = module.chargeTypeId ? `, ${nameForType(module.chargeTypeId)}` : '';
  const offline = module.state === 'offline' ? ' /offline' : '';
  return `${base}${charge}${offline}`;
}

function nameForType(typeId: number): string {
  return resolveItemByTypeId(typeId)?.name ?? resolveShipByTypeId(typeId)?.name ?? `Type ${typeId}`;
}
```

- [ ] **Step 4: Update frontend API types**

Modify `web/src/api.ts` saved fit detail/input types to include:

```ts
export interface FitV2Fit { ... }
editorJson?: FitV2Fit | null;
editorVersion?: number;
```

Update `saveFit` and `updateFit` payload types to accept `editorJson`.

- [ ] **Step 5: Verify tests**

Run:

```bash
npm test -- src/fits-v2/conversion.test.ts src/routes/fits.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fits-v2/conversion.ts src/fits-v2/conversion.test.ts web/src/api.ts
git commit -m "Add Fits v2 fit conversion"
```

### Task 5: Add compact Fits v2 catalog endpoint

**Files:**
- Create: `src/fits-v2/catalog.ts`
- Modify: `src/routes/fits.ts`
- Test: `src/fits-v2/catalog.test.ts`
- Test: `src/routes/fits.test.ts`
- Modify: `web/src/api.ts`

**Interfaces:**
- Produces:

```ts
interface FitV2CatalogItem {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  slotType?: FitV2SlotType | 'drone' | 'fighter' | 'cargo';
}

interface FitV2Catalog {
  ships: FitV2CatalogItem[];
  hardware: FitV2CatalogItem[];
}

function getFitV2Catalog(): FitV2Catalog;
```

- [ ] **Step 1: Write failing catalog tests**

Create `src/fits-v2/catalog.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getFitV2Catalog, searchFitV2Catalog } from './catalog.ts';

test('getFitV2Catalog exposes ships and hardware', () => {
  const catalog = getFitV2Catalog();
  assert.ok(catalog.ships.some(ship => ship.name === 'Raven'));
  assert.ok(catalog.hardware.some(item => item.name.includes('Missile Launcher')));
  assert.ok(catalog.hardware.some(item => item.slotType === 'drone' || item.categoryName.toLowerCase().includes('drone')));
});

test('searchFitV2Catalog partial matches ships and hardware', () => {
  const hits = searchFitV2Catalog('rav');
  assert.ok(hits.ships.some(ship => ship.name === 'Raven'));
  const moduleHits = searchFitV2Catalog('launcher');
  assert.ok(moduleHits.hardware.length > 0);
});
```

Append route test:

```ts
test('GET /api/fits/v2/catalog returns ships and hardware', async () => {
  const { app } = createFitRoutesTestApp({ currentUser: { id: 'user-a', email: 'a@example.com', role: 'user' } });
  const res = await app.inject({ method: 'GET', url: '/api/fits/v2/catalog' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.ships.length > 0);
  assert.ok(body.hardware.length > 0);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/fits-v2/catalog.test.ts src/routes/fits.test.ts
```

Expected: FAIL because catalog is missing.

- [ ] **Step 3: Implement catalog using existing metadata**

Create `src/fits-v2/catalog.ts`:

```ts
import { classifyFitItem, resolveItemByTypeId, resolveShipByTypeId } from '../fits/metadata.ts';
import { loadMasteryData } from '../skills/mastery-data.ts';
import type { FitV2SlotType } from './types.ts';

export interface FitV2CatalogItem {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  slotType?: FitV2SlotType | 'drone' | 'fighter' | 'cargo';
}

export interface FitV2Catalog {
  ships: FitV2CatalogItem[];
  hardware: FitV2CatalogItem[];
}

let cache: FitV2Catalog | null = null;

export function getFitV2Catalog(): FitV2Catalog {
  if (cache) return cache;
  const mastery = loadMasteryData();
  const ships = Object.entries(mastery.ships).map(([id, ship]) => ({
    typeId: Number(id),
    name: ship.name,
    groupId: ship.groupId,
    groupName: ship.groupName,
    categoryId: 6,
    categoryName: 'Ship',
  }));
  const hardware = Object.entries(mastery.items)
    .map(([id, item]) => ({
      typeId: Number(id),
      name: item.name,
      groupId: item.groupId,
      groupName: item.groupName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      slotType: roleToSlotType(classifyFitItem(resolveItemByTypeId(Number(id)))),
    }))
    .filter(item => item.categoryName !== 'Ship');
  cache = { ships: sortItems(ships), hardware: sortItems(hardware) };
  return cache;
}

export function searchFitV2Catalog(query: string): FitV2Catalog {
  const q = query.trim().toLowerCase();
  const catalog = getFitV2Catalog();
  if (q.length < 2) return catalog;
  return {
    ships: catalog.ships.filter(item => item.name.toLowerCase().includes(q)).slice(0, 100),
    hardware: catalog.hardware.filter(item => item.name.toLowerCase().includes(q)).slice(0, 200),
  };
}

function roleToSlotType(role: ReturnType<typeof classifyFitItem>): FitV2CatalogItem['slotType'] {
  if (role === 'droneBay') return 'drone';
  if (role === 'fighterBay') return 'fighter';
  if (role === 'extras' || role === 'unmatched' || role == null) return 'cargo';
  if (role === 'mid') return 'mid';
  return role;
}

function sortItems<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
```

If `mastery.items` is missing a common hardware item set, extend the catalog by iterating `resolveItemByTypeId` from Fuzzwork-supported IDs in `metadata.ts` instead of only `loadMasteryData()`.

- [ ] **Step 4: Add route**

Modify `src/routes/fits.ts`:

```ts
import { getFitV2Catalog, searchFitV2Catalog } from '../fits-v2/catalog.ts';
```

Add before `/:id` routes:

```ts
app.get('/api/fits/v2/catalog', async (req) => {
  const q = String((req.query as { q?: string }).q ?? '');
  return q.trim().length >= 2 ? searchFitV2Catalog(q) : getFitV2Catalog();
});
```

- [ ] **Step 5: Add frontend API helper**

Modify `web/src/api.ts`:

```ts
export interface FitV2CatalogItem { ... }
export interface FitV2Catalog { ships: FitV2CatalogItem[]; hardware: FitV2CatalogItem[]; }

export async function fetchFitV2Catalog(q = ''): Promise<FitV2Catalog | { error: string }> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return jsonOrError(await fetch(`/api/fits/v2/catalog${qs}`));
}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
npm test -- src/fits-v2/catalog.test.ts src/routes/fits.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/fits-v2/catalog.ts src/fits-v2/catalog.test.ts src/routes/fits.ts src/routes/fits.test.ts web/src/api.ts
git commit -m "Add Fits v2 catalog endpoint"
```

## Milestone 3: Editor UI Foundation

### Task 6: Add Fits v2 state provider and editor actions

**Files:**
- Create: `web/src/fits-v2/types.ts`
- Create: `web/src/fits-v2/FitsV2Provider.tsx`
- Create: `web/src/fits-v2/useFitsV2Editor.ts`
- Test: `src/fits/fits-v2-editor-view.test.ts`

**Interfaces:**
- Produces:
  - `FitsV2Provider`
  - `useFitsV2Editor()`
  - Actions: `createFit`, `setName`, `setNotes`, `addModule`, `removeModule`, `setModuleState`, `setCharge`, `addDrone`, `addCargo`, `markSaved`

- [ ] **Step 1: Write failing static editor tests**

Create `src/fits/fits-v2-editor-view.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Fits v2 editor provider exposes manual editing actions and dirty state', () => {
  const provider = readFileSync(resolve('web/src/fits-v2/FitsV2Provider.tsx'), 'utf8');
  assert.match(provider, /dirty/);
  assert.match(provider, /createFit/);
  assert.match(provider, /addModule/);
  assert.match(provider, /removeModule/);
  assert.match(provider, /setModuleState/);
  assert.match(provider, /markSaved/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/fits/fits-v2-editor-view.test.ts
```

Expected: FAIL because provider does not exist.

- [ ] **Step 3: Create frontend types**

Create `web/src/fits-v2/types.ts` mirroring `src/fits-v2/types.ts`:

```ts
export type FitV2ModuleState = 'offline' | 'online' | 'active' | 'overheated';
export type FitV2SlotType = 'high' | 'mid' | 'low' | 'rig' | 'subsystem' | 'service';
export interface FitV2Slot { type: FitV2SlotType; index: number; }
export interface FitV2Module { typeId: number; slot: FitV2Slot; state: FitV2ModuleState; chargeTypeId?: number; }
export interface FitV2DroneItem { typeId: number; active: number; passive: number; }
export interface FitV2CargoItem { typeId: number; quantity: number; }
export interface FitV2Fit { name: string; notes: string; shipTypeId: number; modules: FitV2Module[]; drones: FitV2DroneItem[]; cargo: FitV2CargoItem[]; }
```

- [ ] **Step 4: Implement provider**

Create `web/src/fits-v2/FitsV2Provider.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FitV2Fit, FitV2ModuleState, FitV2Slot, FitV2SlotType } from './types.ts';

interface FitsV2Editor {
  fit: FitV2Fit | null;
  dirty: boolean;
  createFit: (shipTypeId: number, name: string) => void;
  loadFit: (fit: FitV2Fit) => void;
  setName: (name: string) => void;
  setNotes: (notes: string) => void;
  addModule: (slotType: FitV2SlotType, typeId: number) => void;
  removeModule: (slot: FitV2Slot) => void;
  setModuleState: (slot: FitV2Slot, state: FitV2ModuleState) => void;
  setCharge: (slot: FitV2Slot, chargeTypeId: number | null) => void;
  addDrone: (typeId: number, quantity: number) => void;
  addCargo: (typeId: number, quantity: number) => void;
  markSaved: () => void;
}

const FitsV2Context = createContext<FitsV2Editor | null>(null);

export function FitsV2Provider({ children }: { children: ReactNode }) {
  const [fit, setFit] = useState<FitV2Fit | null>(null);
  const [dirty, setDirty] = useState(false);
  const edit = (fn: (fit: FitV2Fit) => FitV2Fit) => {
    setFit(current => current ? fn(current) : current);
    setDirty(true);
  };
  const value = useMemo<FitsV2Editor>(() => ({
    fit,
    dirty,
    createFit: (shipTypeId, name) => {
      setFit({ shipTypeId, name, notes: '', modules: [], drones: [], cargo: [] });
      setDirty(true);
    },
    loadFit: (nextFit) => {
      setFit(nextFit);
      setDirty(false);
    },
    setName: (name) => edit(current => ({ ...current, name })),
    setNotes: (notes) => edit(current => ({ ...current, notes })),
    addModule: (slotType, typeId) => edit(current => {
      const used = current.modules.filter(module => module.slot.type === slotType).map(module => module.slot.index);
      const index = firstFreeIndex(used);
      return { ...current, modules: [...current.modules, { typeId, slot: { type: slotType, index }, state: 'active' }] };
    }),
    removeModule: (slot) => edit(current => ({ ...current, modules: current.modules.filter(module => module.slot.type !== slot.type || module.slot.index !== slot.index) })),
    setModuleState: (slot, state) => edit(current => ({ ...current, modules: current.modules.map(module => module.slot.type === slot.type && module.slot.index === slot.index ? { ...module, state } : module) })),
    setCharge: (slot, chargeTypeId) => edit(current => ({ ...current, modules: current.modules.map(module => module.slot.type === slot.type && module.slot.index === slot.index ? { ...module, ...(chargeTypeId == null ? { chargeTypeId: undefined } : { chargeTypeId }) } : module) })),
    addDrone: (typeId, quantity) => edit(current => ({ ...current, drones: mergeDrone(current.drones, typeId, quantity) })),
    addCargo: (typeId, quantity) => edit(current => ({ ...current, cargo: mergeCargo(current.cargo, typeId, quantity) })),
    markSaved: () => setDirty(false),
  }), [fit, dirty]);
  return <FitsV2Context.Provider value={value}>{children}</FitsV2Context.Provider>;
}

export function useFitsV2Editor(): FitsV2Editor {
  const value = useContext(FitsV2Context);
  if (!value) throw new Error('useFitsV2Editor must be used inside FitsV2Provider');
  return value;
}

function firstFreeIndex(used: number[]): number {
  for (let i = 1; i <= 8; i++) if (!used.includes(i)) return i;
  return Math.max(1, ...used) + 1;
}

function mergeCargo(cargo: FitV2Fit['cargo'], typeId: number, quantity: number) {
  const existing = cargo.find(item => item.typeId === typeId);
  if (!existing) return [...cargo, { typeId, quantity }];
  return cargo.map(item => item.typeId === typeId ? { ...item, quantity: item.quantity + quantity } : item);
}

function mergeDrone(drones: FitV2Fit['drones'], typeId: number, quantity: number) {
  const existing = drones.find(item => item.typeId === typeId);
  if (!existing) return [...drones, { typeId, active: 0, passive: quantity }];
  return drones.map(item => item.typeId === typeId ? { ...item, passive: item.passive + quantity } : item);
}
```

- [ ] **Step 5: Add hook re-export**

Create `web/src/fits-v2/useFitsV2Editor.ts`:

```ts
export { useFitsV2Editor } from './FitsV2Provider.tsx';
```

- [ ] **Step 6: Verify tests**

Run:

```bash
npm test -- src/fits/fits-v2-editor-view.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/fits-v2/types.ts web/src/fits-v2/FitsV2Provider.tsx web/src/fits-v2/useFitsV2Editor.ts src/fits/fits-v2-editor-view.test.ts
git commit -m "Add Fits v2 editor state"
```

### Task 7: Build hull and hardware browsers

**Files:**
- Create: `web/src/fits-v2/HullBrowser.tsx`
- Create: `web/src/fits-v2/HardwareBrowser.tsx`
- Modify: `web/src/fits-v2/FitsV2View.tsx`
- Modify: `web/src/styles.css`
- Test: `src/fits/fits-v2-view.test.ts`

**Interfaces:**
- Consumes: `fetchFitV2Catalog`, `fetchFits`, `useFitsV2Editor`
- Produces: searchable left-column hull/fits/hardware browser.

- [ ] **Step 1: Add failing static test assertions**

Modify `src/fits/fits-v2-view.test.ts`:

```ts
const hullBrowser = readFileSync(resolve('web/src/fits-v2/HullBrowser.tsx'), 'utf8');
const hardwareBrowser = readFileSync(resolve('web/src/fits-v2/HardwareBrowser.tsx'), 'utf8');
assert.match(hullBrowser, /Search hulls/);
assert.match(hullBrowser, /createFit/);
assert.match(hardwareBrowser, /Search hardware/);
assert.match(hardwareBrowser, /addModule|addDrone|addCargo/);
assert.match(fitsView, /HullBrowser/);
assert.match(fitsView, /HardwareBrowser/);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/fits/fits-v2-view.test.ts
```

Expected: FAIL because browsers do not exist.

- [ ] **Step 3: Implement HullBrowser**

Create `web/src/fits-v2/HullBrowser.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { fetchFitV2Catalog, fetchFits, type FitV2CatalogItem, type LibraryVisibility, type SavedFitSummary } from '../api.ts';
import { useFitsV2Editor } from './useFitsV2Editor.ts';

export function HullBrowser({ visibility, onOpenSavedFit }: { visibility: LibraryVisibility; onOpenSavedFit: (id: number) => void }) {
  const editor = useFitsV2Editor();
  const [search, setSearch] = useState('');
  const [ships, setShips] = useState<FitV2CatalogItem[]>([]);
  const [fits, setFits] = useState<SavedFitSummary[]>([]);
  useEffect(() => {
    fetchFitV2Catalog().then(result => { if (!('error' in result)) setShips(result.ships); });
    fetchFits(visibility).then(setFits);
  }, [visibility]);
  const filteredShips = useMemo(() => ships.filter(ship => ship.name.toLowerCase().includes(search.toLowerCase())).slice(0, 80), [ships, search]);
  const filteredFits = useMemo(() => fits.filter(fit => `${fit.shipName} ${fit.fitName}`.toLowerCase().includes(search.toLowerCase())).slice(0, 80), [fits, search]);
  return (
    <section className="fits-v2-browser" aria-label="Hull and saved fits">
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search hulls or fits" />
      <div className="fits-v2-browser-section">
        <h3>Saved Fits</h3>
        {filteredFits.map(fit => (
          <button key={fit.id} type="button" onClick={() => onOpenSavedFit(fit.id)}>
            <img src={`https://images.evetech.net/types/${fit.shipTypeId}/icon?size=32`} alt="" />
            <span>{fit.shipName}</span>
            <small>{fit.fitName}</small>
          </button>
        ))}
      </div>
      <div className="fits-v2-browser-section">
        <h3>Hulls</h3>
        {filteredShips.map(ship => (
          <button key={ship.typeId} type="button" onClick={() => editor.createFit(ship.typeId, `New ${ship.name}`)}>
            <img src={`https://images.evetech.net/types/${ship.typeId}/icon?size=32`} alt="" />
            <span>{ship.name}</span>
            <small>{ship.groupName}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement HardwareBrowser**

Create `web/src/fits-v2/HardwareBrowser.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { fetchFitV2Catalog, type FitV2CatalogItem } from '../api.ts';
import { useFitsV2Editor } from './useFitsV2Editor.ts';

export function HardwareBrowser() {
  const editor = useFitsV2Editor();
  const [search, setSearch] = useState('');
  const [hardware, setHardware] = useState<FitV2CatalogItem[]>([]);
  useEffect(() => {
    fetchFitV2Catalog().then(result => { if (!('error' in result)) setHardware(result.hardware); });
  }, []);
  const filtered = useMemo(() => hardware.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 160), [hardware, search]);
  const addItem = (item: FitV2CatalogItem) => {
    if (item.slotType === 'drone' || item.slotType === 'fighter') editor.addDrone(item.typeId, 1);
    else if (item.slotType === 'high' || item.slotType === 'mid' || item.slotType === 'low' || item.slotType === 'rig' || item.slotType === 'subsystem' || item.slotType === 'service') editor.addModule(item.slotType, item.typeId);
    else editor.addCargo(item.typeId, 1);
  };
  return (
    <section className="fits-v2-browser" aria-label="Hardware">
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search hardware" />
      <div className="fits-v2-browser-section">
        {filtered.map(item => (
          <button key={item.typeId} type="button" onDoubleClick={() => addItem(item)} onClick={() => addItem(item)}>
            <img src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`} alt="" />
            <span>{item.name}</span>
            <small>{item.groupName}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Mount browsers in FitsV2View**

Wrap `FitsV2View` with `FitsV2Provider` and render:

```tsx
<FitsV2Provider>
  <div className="fits-v2-layout">
    <aside className="fits-v2-left">
      <HullBrowser visibility={visibility} onOpenSavedFit={onOpenFitRoute} />
      <HardwareBrowser />
    </aside>
    <section className="fits-v2-center">...</section>
    <aside className="fits-v2-right">...</aside>
  </div>
</FitsV2Provider>
```

- [ ] **Step 6: Add compact styles**

Add `.fits-v2-layout`, `.fits-v2-left`, `.fits-v2-center`, `.fits-v2-right`, `.fits-v2-browser`, `.fits-v2-browser-section` styles. Use dense rows, 6px radius or less, and avoid cards inside cards.

- [ ] **Step 7: Verify tests and build**

Run:

```bash
npm test -- src/fits/fits-v2-view.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/fits-v2/HullBrowser.tsx web/src/fits-v2/HardwareBrowser.tsx web/src/fits-v2/FitsV2View.tsx web/src/styles.css src/fits/fits-v2-view.test.ts
git commit -m "Add Fits v2 browsers"
```

### Task 8: Add fitting ring, slots, drones, cargo, and manual save

**Files:**
- Create: `web/src/fits-v2/FittingRing.tsx`
- Create: `web/src/fits-v2/FitSlot.tsx`
- Create: `web/src/fits-v2/DroneCargoPanel.tsx`
- Create: `web/src/fits-v2/FitV2Actions.tsx`
- Modify: `web/src/fits-v2/FitsV2View.tsx`
- Modify: `web/src/styles.css`
- Test: `src/fits/fits-v2-view.test.ts`

**Interfaces:**
- Consumes: `useFitsV2Editor`, `saveFit`, `updateFit`, `fitV2ToRawEftAndMetadata` equivalent frontend helper or server route.
- Produces: usable edit/save UI with manual save only.

- [ ] **Step 1: Add failing static assertions**

Update `src/fits/fits-v2-view.test.ts`:

```ts
const ring = readFileSync(resolve('web/src/fits-v2/FittingRing.tsx'), 'utf8');
const actions = readFileSync(resolve('web/src/fits-v2/FitV2Actions.tsx'), 'utf8');
assert.match(ring, /High Slots/);
assert.match(ring, /Mid Slots/);
assert.match(ring, /Low Slots/);
assert.match(ring, /Rig Slots/);
assert.match(actions, /Save/);
assert.match(actions, /dirty/);
assert.doesNotMatch(actions, /useEffect\\([^)]*saveFit/s);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/fits/fits-v2-view.test.ts
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement FitSlot**

Create `web/src/fits-v2/FitSlot.tsx`:

```tsx
import { useFitsV2Editor } from './useFitsV2Editor.ts';
import type { FitV2Module, FitV2SlotType } from './types.ts';

export function FitSlot({ slotType, index, module }: { slotType: FitV2SlotType; index: number; module?: FitV2Module }) {
  const editor = useFitsV2Editor();
  if (!module) return <div className="fits-v2-slot empty" title={`${slotType} ${index}`} />;
  return (
    <div className={`fits-v2-slot fitted ${module.state}`} title={`Type ${module.typeId}`}>
      <img src={`https://images.evetech.net/types/${module.typeId}/icon?size=64`} alt="" />
      <select value={module.state} onChange={event => editor.setModuleState(module.slot, event.target.value as FitV2Module['state'])}>
        <option value="offline">Offline</option>
        <option value="online">Online</option>
        <option value="active">Active</option>
        <option value="overheated">Overheated</option>
      </select>
      <button type="button" onClick={() => editor.removeModule(module.slot)}>Remove</button>
    </div>
  );
}
```

- [ ] **Step 4: Implement FittingRing**

Create `web/src/fits-v2/FittingRing.tsx`:

```tsx
import { useFitsV2Editor } from './useFitsV2Editor.ts';
import { FitSlot } from './FitSlot.tsx';
import type { FitV2SlotType } from './types.ts';

const SECTIONS: Array<{ type: FitV2SlotType; label: string; count: number }> = [
  { type: 'high', label: 'High Slots', count: 8 },
  { type: 'mid', label: 'Mid Slots', count: 8 },
  { type: 'low', label: 'Low Slots', count: 8 },
  { type: 'rig', label: 'Rig Slots', count: 3 },
  { type: 'subsystem', label: 'Subsystems', count: 4 },
  { type: 'service', label: 'Service Slots', count: 8 },
];

export function FittingRing() {
  const { fit } = useFitsV2Editor();
  if (!fit) return <div className="fits-v2-empty">Choose a hull to start a fit.</div>;
  return (
    <div className="fits-v2-ring">
      <div className="fits-v2-hull">
        <img src={`https://images.evetech.net/types/${fit.shipTypeId}/render?size=256`} alt="" />
        <h2>{fit.name}</h2>
      </div>
      {SECTIONS.map(section => (
        <section key={section.type} className="fits-v2-slot-section">
          <h3>{section.label}</h3>
          <div className="fits-v2-slot-grid">
            {Array.from({ length: section.count }, (_, idx) => {
              const index = idx + 1;
              const module = fit.modules.find(item => item.slot.type === section.type && item.slot.index === index);
              return <FitSlot key={`${section.type}-${index}`} slotType={section.type} index={index} module={module} />;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Task 12 replaces hard-coded slot counts with catalog/layout simulation. This task intentionally makes the first editor visible and usable.

- [ ] **Step 5: Implement drones and cargo panel**

Create `web/src/fits-v2/DroneCargoPanel.tsx`:

```tsx
import { useFitsV2Editor } from './useFitsV2Editor.ts';

export function DroneCargoPanel() {
  const { fit } = useFitsV2Editor();
  if (!fit) return null;
  return (
    <section className="fits-v2-drone-cargo">
      <h3>Drones</h3>
      {fit.drones.map(item => <div key={item.typeId}>Type {item.typeId} x{item.active + item.passive}</div>)}
      <h3>Cargo</h3>
      {fit.cargo.map(item => <div key={item.typeId}>Type {item.typeId} x{item.quantity}</div>)}
    </section>
  );
}
```

- [ ] **Step 6: Implement manual actions**

Create `web/src/fits-v2/FitV2Actions.tsx`:

```tsx
import { saveFit, updateFit, type LibraryVisibility } from '../api.ts';
import { useFitsV2Editor } from './useFitsV2Editor.ts';

function exportEftFallback(fit: NonNullable<ReturnType<typeof useFitsV2Editor>['fit']>): string {
  return `[Type ${fit.shipTypeId}, ${fit.name}]\\n`;
}

export function FitV2Actions({ visibility, savedFitId, onSaved }: { visibility: LibraryVisibility; savedFitId: number | null; onSaved: (id: number) => void }) {
  const editor = useFitsV2Editor();
  const fit = editor.fit;
  const save = async () => {
    if (!fit) return;
    const rawEft = exportEftFallback(fit);
    const payload = { rawEft, shipTypeId: fit.shipTypeId, fitName: fit.name, notes: fit.notes, visibility, editorJson: fit };
    const result = savedFitId == null ? await saveFit(payload) : await updateFit(savedFitId, payload);
    if ('error' in result) window.alert(result.error);
    else {
      editor.markSaved();
      onSaved(result.id);
    }
  };
  return (
    <section className="fits-v2-actions">
      <button type="button" disabled={!fit || !editor.dirty} onClick={save}>Save</button>
      <button type="button" disabled={!fit} onClick={() => fit && navigator.clipboard.writeText(exportEftFallback(fit))}>Copy EFT</button>
      {editor.dirty && <span>Unsaved changes</span>}
    </section>
  );
}
```

Task 9 replaces `exportEftFallback` with shared conversion.

- [ ] **Step 7: Mount center and right panels**

Modify `FitsV2View.tsx` to render `FittingRing`, `DroneCargoPanel`, and `FitV2Actions`.

- [ ] **Step 8: Verify build**

Run:

```bash
npm test -- src/fits/fits-v2-view.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/fits-v2/FittingRing.tsx web/src/fits-v2/FitSlot.tsx web/src/fits-v2/DroneCargoPanel.tsx web/src/fits-v2/FitV2Actions.tsx web/src/fits-v2/FitsV2View.tsx web/src/styles.css src/fits/fits-v2-view.test.ts
git commit -m "Add Fits v2 editing surface"
```

## Milestone 4: Pricing, Send, Skill Profiles, And Basic Simulation

### Task 9: Wire real EFT export, pricing, and send

**Files:**
- Create: `web/src/fits-v2/fitV2Export.ts`
- Modify: `web/src/fits-v2/FitV2Actions.tsx`
- Modify: `web/src/fits-v2/FitsV2View.tsx`
- Test: `src/fits/fits-v2-view.test.ts`

**Interfaces:**
- Produces:
  - `fitV2ToEft(fit: FitV2Fit, nameForType: (typeId: number) => string): string`
  - Price via existing `quoteDraftFit`
  - Send via existing `sendDraftFit`

- [ ] **Step 1: Write failing static assertions**

Assert `FitV2Actions.tsx` imports `quoteDraftFit`, `sendDraftFit`, and no longer contains `exportEftFallback`.

- [ ] **Step 2: Implement frontend EFT export helper**

Create `web/src/fits-v2/fitV2Export.ts` with the same section ordering as server conversion. It receives a type-name lookup function from loaded catalog.

- [ ] **Step 3: Add price refresh**

In `FitV2Actions`, add hub selector and `Refresh Price` button:

```ts
const quote = await quoteDraftFit({ rawEft, shipTypeId: fit.shipTypeId, hub });
```

Render hull/fitted/extras/grand total if available.

- [ ] **Step 4: Add send fit**

Add pilot selector from `chars`, send button labeled `Send Fit`, and call:

```ts
sendDraftFit({ rawEft, shipTypeId: fit.shipTypeId, fitName: fit.name, notes: fit.notes, characterId })
```

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/fits/fits-v2-view.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/fits-v2/fitV2Export.ts web/src/fits-v2/FitV2Actions.tsx web/src/fits-v2/FitsV2View.tsx src/fits/fits-v2-view.test.ts
git commit -m "Wire Fits v2 price and send actions"
```

### Task 10: Add skill profile selector with All V and pilot choices

**Files:**
- Create: `web/src/fits-v2/SkillProfileSelector.tsx`
- Modify: `web/src/fits-v2/FitsV2Provider.tsx`
- Modify: `web/src/fits-v2/FitsV2View.tsx`
- Create: `src/fits-v2/skill-profile.ts`
- Test: `src/fits-v2/skill-profile.test.ts`
- Test: `src/fits/fits-v2-view.test.ts`

**Interfaces:**
- Produces:
  - `FitV2SkillProfile = { kind: 'all-v' } | { kind: 'pilot'; characterId: number }`
  - `levelForSkill(profile, skillTypeId): number`

- [ ] **Step 1: Write failing skill profile tests**

Create `src/fits-v2/skill-profile.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelForSkill } from './skill-profile.ts';

test('All V profile returns level 5 for any skill', () => {
  assert.equal(levelForSkill({ kind: 'all-v' }, 3330), 5);
});

test('pilot profile returns cached skill level or zero', () => {
  const profile = { kind: 'pilot' as const, characterId: 1, skills: new Map([[3330, 4]]) };
  assert.equal(levelForSkill(profile, 3330), 4);
  assert.equal(levelForSkill(profile, 999999), 0);
});
```

- [ ] **Step 2: Implement skill profile module**

Create `src/fits-v2/skill-profile.ts`:

```ts
export type FitV2SkillProfile =
  | { kind: 'all-v' }
  | { kind: 'pilot'; characterId: number; skills: Map<number, number> };

export function levelForSkill(profile: FitV2SkillProfile, skillTypeId: number): number {
  if (profile.kind === 'all-v') return 5;
  return Math.max(0, Math.min(5, Math.floor(profile.skills.get(skillTypeId) ?? 0)));
}
```

- [ ] **Step 3: Add frontend selector**

Create `web/src/fits-v2/SkillProfileSelector.tsx`:

```tsx
import type { CharacterStatus } from '../api.ts';

export type FitV2SkillProfileChoice = 'all-v' | `pilot:${number}`;

export function SkillProfileSelector({ chars, value, onChange }: { chars: CharacterStatus[]; value: FitV2SkillProfileChoice; onChange: (value: FitV2SkillProfileChoice) => void }) {
  return (
    <label className="fits-v2-skill-profile">
      Skill profile
      <select value={value} onChange={event => onChange(event.target.value as FitV2SkillProfileChoice)}>
        <option value="all-v">All V</option>
        {chars.map(char => <option key={char.characterId} value={`pilot:${char.characterId}`}>{char.name}</option>)}
      </select>
    </label>
  );
}
```

- [ ] **Step 4: Wire provider state and mount**

Add `skillProfile` state to `FitsV2Provider`, expose setter, and mount `SkillProfileSelector` in right column.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/fits-v2/skill-profile.test.ts src/fits/fits-v2-view.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fits-v2/skill-profile.ts src/fits-v2/skill-profile.test.ts web/src/fits-v2/SkillProfileSelector.tsx web/src/fits-v2/FitsV2Provider.tsx web/src/fits-v2/FitsV2View.tsx src/fits/fits-v2-view.test.ts
git commit -m "Add Fits v2 skill profiles"
```

### Task 11: Add basic simulation endpoint and stats panel

**Files:**
- Create: `src/fits-v2/simulation.ts`
- Modify: `src/routes/fits.ts`
- Create: `src/fits-v2/simulation.test.ts`
- Create: `web/src/fits-v2/StatsPanel.tsx`
- Modify: `web/src/fits-v2/FitsV2View.tsx`
- Modify: `web/src/api.ts`

**Interfaces:**
- Produces:

```ts
interface FitV2SimulationResult {
  slots: Record<FitV2SlotType, number>;
  usedSlots: Record<FitV2SlotType, number>;
  warnings: FitV2Warning[];
}
```

- [ ] **Step 1: Write failing simulation tests**

Create `src/fits-v2/simulation.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFitV2 } from './simulation.ts';

test('simulateFitV2 reports slot usage and over-slot warnings', () => {
  const fit = {
    name: 'Too Many Highs',
    notes: '',
    shipTypeId: 638,
    modules: Array.from({ length: 9 }, (_, i) => ({ typeId: 2048, slot: { type: 'high' as const, index: i + 1 }, state: 'active' as const })),
    drones: [],
    cargo: [],
  };
  const result = simulateFitV2(fit);
  assert.equal(result.usedSlots.high, 9);
  assert.ok(result.warnings.some(warning => warning.code === 'over-slot'));
});
```

- [ ] **Step 2: Implement phase 1 simulation**

Create `src/fits-v2/simulation.ts`:

```ts
import { getShipLayout } from '../fits/metadata.ts';
import type { FitV2Fit, FitV2SlotType, FitV2Warning } from './types.ts';

const SLOT_TYPES: FitV2SlotType[] = ['high', 'mid', 'low', 'rig', 'subsystem', 'service'];

export interface FitV2SimulationResult {
  slots: Record<FitV2SlotType, number>;
  usedSlots: Record<FitV2SlotType, number>;
  warnings: FitV2Warning[];
}

export function simulateFitV2(fit: FitV2Fit): FitV2SimulationResult {
  const layout = getShipLayout(fit.shipTypeId);
  const slots = {
    high: layout.highSlots,
    mid: layout.midSlots,
    low: layout.lowSlots,
    rig: layout.rigSlots,
    subsystem: layout.subsystemSlots,
    service: layout.serviceSlots,
  };
  const usedSlots = Object.fromEntries(SLOT_TYPES.map(type => [type, 0])) as Record<FitV2SlotType, number>;
  for (const module of fit.modules) usedSlots[module.slot.type] += 1;
  const warnings: FitV2Warning[] = [];
  for (const type of SLOT_TYPES) {
    if (usedSlots[type] > slots[type]) warnings.push({ code: 'over-slot', message: `${usedSlots[type]} ${type} modules fitted but hull has ${slots[type]} slots.` });
  }
  return { slots, usedSlots, warnings };
}
```

- [ ] **Step 3: Add route**

In `src/routes/fits.ts`:

```ts
app.post('/api/fits/v2/simulate', async (req, reply) => {
  try {
    const fit = validateFitV2Fit((req.body as { fit?: unknown } | undefined)?.fit);
    return simulateFitV2(fit);
  } catch (err) {
    return reply.code(400).send({ error: errorMessage(err, 'failed to simulate fit') });
  }
});
```

- [ ] **Step 4: Add API helper and StatsPanel**

`web/src/api.ts`:

```ts
export async function simulateFitV2(fit: FitV2Fit): Promise<FitV2SimulationResult | { error: string }> {
  return jsonOrError(await fetch('/api/fits/v2/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fit }),
  }));
}
```

Create `web/src/fits-v2/StatsPanel.tsx` with a `useEffect` that calls `simulateFitV2(editor.fit)` and renders slot usage plus warnings.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/fits-v2/simulation.test.ts src/routes/fits.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fits-v2/simulation.ts src/fits-v2/simulation.test.ts src/routes/fits.ts src/routes/fits.test.ts web/src/api.ts web/src/fits-v2/StatsPanel.tsx web/src/fits-v2/FitsV2View.tsx
git commit -m "Add Fits v2 basic simulation"
```

## Milestone 5: Dogma Deepening

### Task 12: Generate richer dogma catalog data

**Files:**
- Modify: `scripts/build-mastery-data.ts`
- Modify: `data/eve-mastery.json`
- Create: `src/fits-v2/dogma-data.ts`
- Test: `src/fits-v2/dogma-data.test.ts`

**Goal:** Add enough deterministic dogma data for CPU, power grid, calibration, capacity, hardpoints, and charge compatibility.

**Steps:**

- [ ] Add a failing test that asserts `loadFitV2DogmaData()` has Raven slot counts, CPU output, power output, calibration, and at least one launcher charge group.
- [ ] Extend `scripts/build-mastery-data.ts` to include a compact `dogma` object keyed by type ID.
- [ ] Implement `src/fits-v2/dogma-data.ts` to expose typed accessors over the generated data.
- [ ] Run `npm run build:mastery`.
- [ ] Run `npm test -- src/fits-v2/dogma-data.test.ts && npm run typecheck`.
- [ ] Commit `scripts/build-mastery-data.ts`, `data/eve-mastery.json`, and `src/fits-v2/dogma-data.ts`.

### Task 13: Add CPU, power grid, calibration, capacity, and charge validation

**Files:**
- Modify: `src/fits-v2/simulation.ts`
- Modify: `src/fits-v2/simulation.test.ts`
- Modify: `web/src/fits-v2/StatsPanel.tsx`

**Goal:** Upgrade simulation from slot counts to first useful fitting constraints.

**Steps:**

- [ ] Add tests for CPU used/free changing after module add/remove.
- [ ] Add tests for power grid used/free changing after module add/remove.
- [ ] Add tests for rig calibration over-limit warnings.
- [ ] Add tests for cargo capacity and drone bandwidth warnings.
- [ ] Add tests for incompatible charge warnings.
- [ ] Implement calculations using `dogma-data.ts`.
- [ ] Render CPU, PG, calibration, cargo, drone bandwidth, and warning rows in `StatsPanel`.
- [ ] Run `npm test -- src/fits-v2/simulation.test.ts && npm run typecheck && npm run build`.
- [ ] Commit.

### Task 14: Add pilot skill profile data to simulation

**Files:**
- Modify: `src/fits-v2/skill-profile.ts`
- Modify: `src/fits-v2/simulation.ts`
- Modify: `src/routes/fits.ts`
- Modify: `web/src/fits-v2/SkillProfileSelector.tsx`
- Modify: `web/src/fits-v2/StatsPanel.tsx`
- Test: `src/fits-v2/skill-profile.test.ts`
- Test: `src/fits-v2/simulation.test.ts`

**Goal:** Feed `All V` or pilot cached skills into dogma calculations.

**Steps:**

- [ ] Add route dependency for cached skill lookup using the same store/path as Skills view.
- [ ] Add tests that All V applies level 5 to fitting skill multipliers.
- [ ] Add tests that pilot profile level changes a calculated stat.
- [ ] Include stale/missing skill warnings in simulation output.
- [ ] Render skill profile update/stale hints in `SkillProfileSelector`.
- [ ] Run tests and build.
- [ ] Commit.

### Task 15: Add core defensive and utility stats

**Files:**
- Modify: `src/fits-v2/simulation.ts`
- Modify: `src/fits-v2/simulation.test.ts`
- Modify: `web/src/fits-v2/StatsPanel.tsx`

**Goal:** Add first dogma stats beyond fitting validity.

**Steps:**

- [ ] Add shield/armor/hull HP tests for an unfitted hull.
- [ ] Add resistance tests for active hardeners.
- [ ] Add EHP estimate tests.
- [ ] Add speed, align, signature, targeting range, scan resolution, sensor strength, and max target tests.
- [ ] Implement stats using compact dogma data.
- [ ] Render stats in grouped panels.
- [ ] Run tests and build.
- [ ] Commit.

### Task 16: Add capacitor and offensive stats

**Files:**
- Modify: `src/fits-v2/simulation.ts`
- Modify: `src/fits-v2/simulation.test.ts`
- Modify: `web/src/fits-v2/StatsPanel.tsx`

**Goal:** Add the stats users expect from pyfa-like fitting.

**Steps:**

- [ ] Add capacitor capacity/recharge/stability tests.
- [ ] Add local repair and remote repair rate tests.
- [ ] Add turret/missile/drone DPS tests.
- [ ] Add optimal/falloff/missile range display tests.
- [ ] Implement calculations incrementally and list unsupported effects.
- [ ] Render offensive, repair, and capacitor panels.
- [ ] Run tests and build.
- [ ] Commit.

## Final Verification

- [ ] Run full test suite:

```bash
npm test
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

- [ ] Run production build:

```bash
npm run build
```

- [ ] Manually verify locally:

```bash
npm run dev
```

Manual checks:

- Open `/fits/v2`.
- Create a blank Raven or Archon fit from hull search.
- Add modules by hardware search.
- Remove a module.
- Change a module state.
- Add drones and cargo.
- Save manually.
- Refresh the page and open `/fits/v2/<id>`.
- Copy EFT.
- Price the fit.
- Send Fit to a pilot.
- Switch skill profile between `All V` and at least one pilot.
- Confirm old `/fits`, `/fit/:id`, `/doctrines`, and `/doctrine/:id` still work.

