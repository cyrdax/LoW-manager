# Fits v2 Dogma Editor Design

## Context

The current Fits view is a saved-fit library with EFT import, pyfa screenshot import, Discord import, pricing, manual save, public/private visibility, doctrines, ESI fitting export, and zKill-style read-only display. It works well as a library, but it is not a fitting simulator: users cannot create or edit a fit by choosing a hull and changing modules in the UI, and it does not calculate real dogma stats for a selected pilot.

EVEShipFit provides an MIT-licensed reference implementation for an EVE fitting UI. Its public site is a Next.js app around a reusable React package. The React package exposes reusable concepts that map well to this app:

- `CurrentFitProvider` owns an editor-friendly fit model.
- `FitManagerProvider` exposes actions such as create hull, add item, replace module, set charge, change module state, add cargo, and remove drones.
- `EveDataProvider`, `DogmaEngineProvider`, and `StatisticsProvider` load SDE/dogma data and calculate fitting statistics.
- `ShipFitExtended`, `HullListing`, `HardwareListing`, and `ShipStatistics` provide the main three-column fitting workflow.

The app should learn from and adapt these patterns without replacing the existing Fits view. The first implementation should live under a new `Fits v2` mode so the current library remains stable while the simulator matures.

## Goal

Build a new `Fits v2` view under the existing Fits section where users can create, edit, simulate, price, save, export, and send ship fits using an EVEShipFit-inspired fitting UI backed by this app's saved-fit, pricing, skill, and ESI systems.

## Non-Goals

- Do not remove or rewrite the existing Fits and Doctrines views.
- Do not make autosave the default behavior. Saving remains manual.
- Do not require users to re-create existing fits manually. Existing saved fits should open in `Fits v2` through conversion.
- Do not make EVEShipFit's public Next.js site a runtime dependency.
- Do not block the first usable editor on every edge case in pyfa-level simulation.
- Do not add in-game skill queue writes; ESI cannot add skills to a queue.

## Navigation

The Fits section gains a third internal mode:

- `Fits`
- `Doctrines`
- `Fits v2`

Routes:

- `/fits` opens the current saved-fit library.
- `/doctrines` opens doctrines.
- `/fits/v2` opens the new simulator.
- `/fits/v2/:id` opens a saved fit in the simulator editor.

Existing public/private visibility controls remain at the top of the Fits section and apply to the current library mode, doctrines mode, and `Fits v2` save target. Anonymous users may view public fits in the old view, but `Fits v2` editing and saving require login because pilot skills and persistence are account-scoped.

## User Experience

`Fits v2` uses a dense three-column operational layout inspired by EVEShipFit.

Left column:

- `Hull & Fits` / `Hardware` selector.
- Hull search by ship name.
- Saved-fit search by hull or fit name.
- Hardware search by module, charge, drone, fighter, subsystem, rig, or cargo item name.
- Filters for high, mid, low, rig/subsystem, drone/fighter, charge, and hull-compatible items.
- Double-clicking or dragging hardware adds it to the fit where possible.

Center column:

- Ship fitting ring with hull image.
- Slot placeholders for high, mid, low, rig, subsystem, and service slots.
- Module icons in fitted slots.
- Charge indicator on modules with loaded charges.
- Module state control: offline/passive, online, active, overheated.
- Drone bay and cargo panels.
- Fit history or undo/redo after the core editor is stable.

Right column:

- Skill profile selector.
- Stats panels.
- Price widget and refresh control.
- Fit name and notes.
- Save controls.
- Export EFT.
- Send Fit to selected authenticated pilot.
- Warning panel for invalid modules, missing metadata, over-slot modules, missing skills, and unsupported dogma effects.

## Skill Profiles

The simulator must support two profile types:

- `All V`: every skill used by the dogma engine resolves to level 5.
- Authenticated pilot: skill levels come from cached ESI skill data already used by the Skills view.

The profile selector appears above the stats panel and defaults to:

1. The user's chosen main pilot if available and skills are loaded.
2. The first authenticated pilot with cached skills.
3. `All V` if no pilot skill cache is available.

Pilot skill behavior:

- If cached skills are available, use them immediately.
- If skills are stale, show the last update time and a refresh button.
- If a pilot lacks the required ESI skill scope or skill data has never loaded, show a re-auth or refresh hint.
- The editor remains usable with `All V` even when no pilot skills are available.

## Editor Fit Model

`Fits v2` uses an editor-native model based on EVEShipFit's clean structure:

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
```

This model is separate from the current `FitDraft` display model. The current model remains useful for import, price grouping, warnings, and old view display. Conversion utilities bridge between them.

## Persistence

Extend saved fits with an optional editor payload:

- `editor_json TEXT`
- `editor_version INTEGER NOT NULL DEFAULT 1`

The existing saved fit fields remain authoritative for compatibility:

- `raw_eft`
- `ship_type_id`
- `ship_name`
- `fit_name`
- `notes`
- parsed `saved_fit_items`

Save behavior:

- Creating in `Fits v2` writes both `editor_json` and a generated EFT string.
- Updating in `Fits v2` updates both `editor_json` and generated EFT string.
- Opening an old fit with no `editor_json` converts existing saved fit detail into a best-effort `FitV2Fit`.
- If conversion loses information, warnings are displayed and the original `raw_eft` remains available.
- Save is manual only. Changing modules marks the fit as dirty but does not persist until the user clicks Save.

## API

Add narrowly scoped endpoints and reuse existing ones where possible:

`GET /api/fits/:id`

- Keep existing response.
- Include optional `editorJson` and `editorVersion` when present.

`POST /api/fits`

- Accept existing `rawEft` flow.
- Accept optional `editorJson` for `Fits v2`.
- Server validates `editorJson` against the `FitV2Fit` schema before saving.

`PUT /api/fits/:id`

- Accept optional `editorJson`.
- Server updates parsed item rows from generated EFT or from an editor-to-draft conversion.

`GET /api/fits/v2/catalog`

- Returns compact catalog data for ships, modules, charges, drones, fighters, rigs, subsystems, service modules, categories, groups, and market groups.
- Data comes from bundled SDE/Fuzzwork cache and app mastery data, not from live ESI.

`POST /api/fits/v2/simulate`

- Accepts `{ fit, profile }`.
- Returns dogma stats, validation warnings, and unsupported effect warnings.
- This can be server-side or client-side depending on the dogma engine integration choice. The endpoint shape should exist even if early phases compute locally, so future workers have a stable boundary.

## Dogma Data

The simulator needs richer data than the current fit library:

- Type names, categories, groups, market groups.
- Type dogma attributes.
- Type dogma effects.
- Dogma attribute names.
- Dogma effect names.
- Ship slot counts and hardpoints.
- Skill requirements and skill effects.
- Charge compatibility.
- Module fitting effects and state effects.
- Drone/fighter attributes.

The app already uses Fuzzwork SDE cache for type and slot metadata. `Fits v2` should add a generated compact dogma bundle during `npm run build:mastery` or a new build script. The generated bundle should be deterministic, checked by tests, and small enough for production Vite builds.

## Dogma Engine Strategy

Use a phased implementation:

### Phase 1: Editor Foundation

- Add `Fits v2` navigation.
- Add `FitV2Fit` model and validation.
- Add saved-fit `editor_json` persistence.
- Add old-fit to v2 conversion and v2 to EFT conversion.
- Add hull picker, empty fitting ring, manual save, export EFT, price, and send fit.
- Show slot counts and hardpoint counts.

### Phase 2: Basic Fitting Validation

- Add module category and slot compatibility.
- Add charge compatibility.
- Add CPU and power grid used/free.
- Add calibration and rig size checks.
- Add drone bandwidth and drone bay capacity.
- Add cargo capacity.
- Add warnings for unsupported modules/effects.

### Phase 3: Core Dogma Stats

- Add pilot and All V profile resolution.
- Add ship bonuses.
- Add module state effects.
- Add shield, armor, hull HP.
- Add EM/Thermal/Kinetic/Explosive resistances.
- Add EHP estimates.
- Add speed, align, mass, signature radius.
- Add targeting range, scan resolution, sensor strength, max targets.
- Add capacitor stability and depletion estimate.

### Phase 4: Offense, Logistics, And Advanced Effects

- Add turret, missile, drone, and fighter DPS.
- Add optimal, falloff, missile range, tracking, and application-adjacent display values.
- Add local repair and remote repair rates.
- Add command bursts, scripts, ammo, and charges in more detail.
- Add implants and boosters as optional profile modifiers.
- Add projected effects later only after the single-fit simulator is stable.

## UI Component Boundaries

Create `web/src/fits-v2/` for the new editor surface instead of adding more weight to `FitsView.tsx`.

Recommended files:

- `types.ts`: editor model, stats types, warnings.
- `fitV2Schema.ts`: runtime validation helpers.
- `fitV2Conversion.ts`: saved fit detail to editor model, editor model to EFT, editor model to pricing draft.
- `FitsV2View.tsx`: view shell and data orchestration.
- `FitsV2Provider.tsx`: current fit state, dirty state, selected skill profile, selected saved fit.
- `FitsV2FitManager.tsx`: editor actions for hull, modules, charges, drones, cargo, states.
- `FitsV2Catalog.ts`: catalog loading/search helpers.
- `FittingRing.tsx`: center fitting display.
- `HardwareBrowser.tsx`: left hardware search/filter tree.
- `HullBrowser.tsx`: left hull and saved-fit search.
- `SkillProfileSelector.tsx`: All V and pilot selector.
- `StatsPanel.tsx`: right stats surface.
- `FitV2Actions.tsx`: save, export, send, price controls.

Backend files:

- `src/fits-v2/types.ts`: shared server-side schema/types.
- `src/fits-v2/catalog.ts`: generated catalog access.
- `src/fits-v2/conversion.ts`: editor to old draft/save representation.
- `src/fits-v2/dogma/`: dogma engine adapters.
- `src/routes/fits-v2.ts`: simulator/catalog endpoints if server-side endpoints are used.

## EVEShipFit Code Usage

EVEShipFit is MIT licensed. We may adapt UI ideas and selected component patterns if the license notice is preserved in copied substantial portions.

Preferred approach:

- Use EVEShipFit as a reference for model shape, layout, and interaction patterns.
- Copy only small, necessary pieces after adapting names/styles to this app.
- Keep our own CSS in the app's dark operational style.
- Preserve attribution in a source comment or `NOTICE` file if substantial code is copied.
- Avoid depending directly on the GitHub Package Registry package until deployment auth and data hosting are fully understood.

## Error Handling

The editor should fail soft:

- Missing catalog data shows a clear error and leaves old Fits view usable.
- Unknown item type IDs show as `Type <id>` with a warning.
- Unsupported dogma effects are listed in a warning panel but do not block editing.
- Invalid module placement marks the slot/item and leaves the fit editable.
- Save failures leave the dirty editor state intact.
- Send-to-game failures reuse existing re-auth hint behavior.
- Skill profile failures automatically fall back to `All V` only after telling the user why.

## Testing

Backend tests:

- Migration adds `editor_json` and `editor_version` without losing old saved fits.
- `POST /api/fits` stores valid editor JSON.
- `PUT /api/fits/:id` updates valid editor JSON.
- Invalid editor JSON returns `400`.
- Old saved fits with no editor JSON still load.
- Editor model converts to EFT with expected headers, modules, charges, drones, and cargo.
- Existing pricing and send endpoints still work for v2-saved fits.

Frontend/static tests:

- App routing parses `/fits/v2` and `/fits/v2/:id`.
- Fits mode switch exposes `Fits v2`.
- `FitsV2View` is mounted only for v2 mode.
- Skill profile selector includes `All V` and pilot options.
- Save remains manual and dirty state is visible.
- Hardware browser supports partial search.
- Fitting ring renders empty slot placeholders from hull layout.

Dogma tests:

- All V profile returns level 5 for any requested skill.
- Pilot profile returns cached skill level or 0 for missing skills.
- CPU/PG calculations respond to module add/remove.
- Rig calibration responds to rig add/remove.
- Resist calculations respond to active hardeners.
- Cap calculation responds to active modules once Phase 3 exists.

Manual verification:

- Create a blank hull from search.
- Add modules by double-click.
- Add modules by drag/drop.
- Replace a module.
- Add a charge to a compatible module.
- Add drones and cargo.
- Switch between All V and a pilot.
- Save private fit.
- Publish public fit if owner/admin.
- Open existing saved fit in `Fits v2`.
- Export EFT and re-import it in the old flow.
- Send fit to an authenticated pilot.

## Rollout

Ship incrementally behind the separate `Fits v2` mode:

1. `Fits v2` route and empty editor shell.
2. Editor model, conversion, and save support.
3. Hull and hardware catalog.
4. Fitting ring and basic editing.
5. Price/export/send integration.
6. Skill profile selector.
7. Dogma stats phases.

At every step, the old Fits view remains the fallback. Once `Fits v2` can create, edit, save, price, export, send, and simulate common fits reliably, decide whether it becomes the default `Fits` mode.

