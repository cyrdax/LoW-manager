# Fits Dashboard Design

## Context

Legion of Wayne Manager already has several operational dashboards backed by a local Fastify API, SQLite persistence, bundled SDE-derived metadata, and React views. The new Fits dashboard should follow the same pattern: the browser handles import, selection, and display state; the server owns persistence, EVE metadata resolution, pricing, and authenticated ESI actions.

The app already has useful building blocks:

- `data/eve-mastery.json` contains published ships and items with names, groups, and categories.
- `.cache/fuzzwork/dgmTypeAttributes.csv` contains dogma attributes that can provide ship slot counts.
- `.cache/fuzzwork/invTypes.csv`, `invGroups.csv`, and `invCategories.csv` can support compact item classification.
- The Market dashboard already prices shopping lists by walking in-system sell orders for Jita or Amarr.
- The app already supports authenticated ESI POST calls for actions such as EVEmail and fleet commands.

The Fits dashboard will add a global saved fit library, EFT-style import parsing, zKill-inspired fit display, market-valued totals, and in-game fitting export.

## Goal

Add a top-level **Fits** tab where the user can import, preview, save, search, view, price, copy, and send EVE ship fits.

Version 1 should feel like a saved fit library with a zKillboard-style fit sheet:

- Left-side saved-fit list.
- Right-side selected fit detail.
- Ship header with hull icon, fit name, warning badges, and price summary.
- Fitted slot sections with item icons and empty slot placeholders.
- Cargo/extras sections.
- Notes and export controls.

## Non-Goals

- Multi-fit paste import.
- zKillboard killmail URL or kill ID import.
- Full doctrine management, fleet roles, tags, or collection folders.
- Character skill readiness checks.
- DPS, tank, capacitor, fitting CPU/powergrid, or Pyfa-style simulation.
- In-game deletion or management of existing pilot fittings.
- Exact implant slot modeling.
- Price history or profit tracking for fits.

## User Experience

The Fits tab is a dense operational view, not a landing page.

Initial state:

- If saved fits exist, select the most recently updated saved fit.
- If no saved fits exist, show the import/draft area.

Top-level layout:

- Left panel:
  - Fit library search by fit name or ship hull.
  - Global hub selector: Jita by default, Amarr alternate.
  - Import button.
  - Saved fit rows grouped or visually clustered by hull.
  - Each row shows ship hull, fit name, grand total at selected hub, updated date, and warning badges.
- Right panel:
  - zKill-inspired selected fit view.
  - Import draft, saved fit detail, or empty state.

Fit detail header:

- Ship icon.
- Ship hull name.
- Fit name.
- Saved/draft state.
- Warning badges for unmatched items, over-slot items, and export assignment issues.
- Grand total at selected hub.
- Actions: Save, Copy EFT, Send to Pilot, Refresh Price, Delete for saved fits.

Slot display:

- High, mid, low, rig, service, and subsystem slot sections.
- Slot counts come from selected hull metadata.
- Imported modules fill slot boxes by assigned section/order.
- Empty slots render as dashed placeholders.
- Over-slot modules render in the section with a warning rather than disappearing.
- Item icons are shown for every resolved item.
- Hovering an icon or item row shows a tooltip with the item name.
- Unknown/unmatched items show in an Unmatched section and are excluded from price totals.

Extras display:

- Drones and fighters show in Drone Bay/Fighter Bay sections when item metadata supports that classification.
- Ammo, scripts, deployables, implants, boosters, and other non-slot items show as cargo/extras for V1.
- Items that look like implants or boosters are not modeled as character implants; they are treated as cargo/extras.

Import flow:

1. User clicks Import.
2. User pastes one EFT-style fit.
3. App parses header, sections, items, quantities, and raw EFT text.
4. App resolves ship and item names.
5. App loads the result as an unsaved in-memory draft.
6. If unmatched items exist, an alert modal lists every unmatched item.
7. User may cancel, correct paste, override ship, edit fit name, and edit notes.
8. User manually clicks Save when ready.

Saving is never automatic. Unsaved drafts do not persist across page refresh or navigation.

## Import Format

Support EFT-style text:

```text
[Naglfar, Simulated Naglfar Fitting]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Quad 800mm Repeating Cannon II
Siege Module II

Hail XL x4057
Barrage XL x9022
```

Rules:

- Exactly one fit header is supported.
- Header format is `[Ship Hull, Fit Name]`.
- Header ship is auto-selected.
- Fit name defaults from the header.
- User can override ship manually.
- Blank lines split EFT sections.
- Plain item lines count as quantity 1.
- Duplicate lines aggregate for display/pricing where appropriate, while slot modules still occupy separate slot boxes.
- Trailing quantities like `Templar II x6`, `Hail XL x4057`, and `Barrage XL x9,022` are supported.
- Lines with commas may include loaded charges, such as `Armor Command Burst II, Rapid Repair Charge`; the left side is the fitted module, and the right side is attached charge/cargo for pricing/export where possible.
- Multiple headers produce a validation error asking the user to import one fit at a time.

## Ship Selection

The user can choose any published ship from bundled ship metadata.

Import behavior:

- If the EFT header ship resolves, select it automatically.
- If the header ship does not resolve, leave ship unset and show a validation warning.
- The user can manually pick or override the ship.
- Changing the ship recomputes:
  - Slot placeholders.
  - Over-slot warnings.
  - Ship icon.
  - Hull cost.
  - In-game fitting export payload.

## Slot Layout Metadata

V1 needs real slot placeholders. The backend should derive slot counts from SDE/Fuzzwork dogma attributes.

Required counts:

- High slots.
- Mid slots.
- Low slots.
- Rig slots.
- Service slots.
- Subsystem slots.

Implementation should add a compact fitting metadata module that reads cached SDE/Fuzzwork data and exposes:

```ts
interface FitShipLayout {
  shipTypeId: number;
  shipName: string;
  highSlots: number;
  midSlots: number;
  lowSlots: number;
  rigSlots: number;
  serviceSlots: number;
  subsystemSlots: number;
}
```

If a slot count cannot be found, default that count to 0 and include a metadata warning for that hull.

## Item Classification

The parser should preserve raw section order and resolved item metadata.

Classification should use both section position and item metadata:

- First fitting sections map to low, mid, high, rig in the common EFT order used by the provided examples.
- Item category/group metadata can override or refine extras:
  - Drones to Drone Bay.
  - Fighters to Fighter Bay.
  - Charges, scripts, ammo, deployables, implants, boosters, and other non-slot items to Cargo/Extras.
- Loaded charges after a comma are captured and priced/exported as cargo-like items unless a better ESI flag assignment is available.
- Unknown items remain in an Unmatched section.

The slot assignment should produce warnings for:

- More low/mid/high/rig/service/subsystem modules than the selected hull supports.
- Resolved items that cannot be assigned to an ESI fitting flag for in-game export.
- Unmatched item names.

## Persistence

Saved fits are global to the app, not owned by a character.

Add SQLite tables for saved fits and their parsed/resolved item rows. A practical schema:

```sql
CREATE TABLE saved_fits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_type_id    INTEGER NOT NULL,
  ship_name       TEXT NOT NULL,
  fit_name        TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  raw_eft         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE saved_fit_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fit_id          INTEGER NOT NULL,
  section_index   INTEGER NOT NULL,
  line_index      INTEGER NOT NULL,
  raw_line        TEXT NOT NULL,
  input_name      TEXT NOT NULL,
  resolved_name   TEXT,
  type_id         INTEGER,
  quantity        INTEGER NOT NULL,
  role            TEXT NOT NULL,
  slot_flag       TEXT,
  warning         TEXT,
  FOREIGN KEY (fit_id) REFERENCES saved_fits(id) ON DELETE CASCADE
);
```

Persistence uses the row tables above as the source of truth. API responses build a stable typed fit shape from those rows rather than returning raw database records.

## Pricing

Pricing uses the same hub model as the Shopping List:

- Global hub selector in the Fits dashboard.
- Jita default.
- Amarr alternate.
- Live price on fit select.
- Manual Refresh Price button.
- Existing market order cache is reused.

Totals:

- Hull total: selected ship hull price.
- Fitted total: fitted modules and rigs.
- Extras total: drones, fighters, ammo, scripts, deployables, implants/boosters-as-cargo, and other extras.
- Grand total: hull + fitted + extras.

Each resolved item row should include:

- Requested quantity.
- Filled quantity.
- Shortfall.
- Average price.
- Subtotal.
- Status: ok, partial, no-orders, unknown-item, or unpriced.

Unmatched items are excluded from totals and flagged. If the hull cannot be priced, show hull as unpriced but still price resolved items.

## In-Game Fitting Export

The Fits dashboard should let the user create the selected fit in a chosen authenticated pilot's personal fitting list.

ESI endpoint:

- `POST /characters/{character_id}/fittings/`
- Requires `esi-fittings.write_fittings.v1`.

Authentication changes:

- Add `esi-fittings.write_fittings.v1` to requested scopes.
- Existing pilots may need re-auth.
- If a selected pilot lacks the scope or ESI returns 403, show a re-auth hint.

Request shape:

```ts
interface EsiFittingCreatePayload {
  name: string;
  description: string;
  ship_type_id: number;
  items: Array<{
    type_id: number;
    flag:
      | 'Cargo'
      | 'DroneBay'
      | 'FighterBay'
      | 'HiSlot0' | 'HiSlot1' | 'HiSlot2' | 'HiSlot3' | 'HiSlot4' | 'HiSlot5' | 'HiSlot6' | 'HiSlot7'
      | 'MedSlot0' | 'MedSlot1' | 'MedSlot2' | 'MedSlot3' | 'MedSlot4' | 'MedSlot5' | 'MedSlot6' | 'MedSlot7'
      | 'LoSlot0' | 'LoSlot1' | 'LoSlot2' | 'LoSlot3' | 'LoSlot4' | 'LoSlot5' | 'LoSlot6' | 'LoSlot7'
      | 'RigSlot0' | 'RigSlot1' | 'RigSlot2'
      | 'ServiceSlot0' | 'ServiceSlot1' | 'ServiceSlot2' | 'ServiceSlot3'
      | 'ServiceSlot4' | 'ServiceSlot5' | 'ServiceSlot6' | 'ServiceSlot7'
      | 'SubSystemSlot0' | 'SubSystemSlot1' | 'SubSystemSlot2' | 'SubSystemSlot3';
    quantity: number;
  }>;
}
```

Export behavior:

- User selects one authenticated pilot from a dropdown.
- App creates the in-game fitting only; it does not send EVEmail in V1.
- Success message includes returned ESI fitting ID.
- Unmatched items and unassignable items are not included in the ESI payload.
- The UI shows a warning before sending when any local fit rows are excluded from the in-game fitting payload.

## Copy EFT

Add Copy EFT for saved fits and drafts.

Behavior:

- Copies normalized EFT text to clipboard.
- Preserves header `[Ship, Fit Name]`.
- Preserves section breaks.
- Uses `Item Name xN` for quantity stacks.
- Uses separate repeated module lines for fitted modules that occupy multiple slots.
- Includes cargo/extras.
- Includes unmatched raw lines if present, with their original text.

## Backend Architecture

Add modules:

- `src/fits/parser.ts`: EFT parser and normalized draft builder.
- `src/fits/metadata.ts`: item lookup, ship lookup, slot layout, classification helpers.
- `src/fits/store.ts`: SQLite migration and saved fit CRUD.
- `src/fits/pricing.ts`: fit quote assembly using market pricing primitives.
- `src/fits/esi.ts`: ESI fitting create payload builder and POST wrapper.
- `src/routes/fits.ts`: Fastify routes.

Market pricing reuse:

- Extract shared order-book pricing utilities from `src/routes/market.ts` into a reusable market service module.
- Shopping List and Fits should use the same price-walking behavior to avoid divergent totals.

Register routes in `src/server.ts`.

## API Design

Endpoints:

- `GET /api/fits`
  - List saved fits with summary metadata and last known warning counts.
- `GET /api/fits/:id`
  - Return full saved fit detail.
- `POST /api/fits/preview`
  - Parse/resolve pasted EFT text and return an unsaved draft.
- `POST /api/fits`
  - Save a draft or explicit fit payload.
- `PUT /api/fits/:id`
  - Update fit name, ship override, notes, and raw/parsed content when needed.
- `DELETE /api/fits/:id`
  - Delete a saved fit.
- `GET /api/fits/ships?q=<query>`
  - Ship autocomplete.
- `POST /api/fits/:id/quote`
  - Price a saved fit at selected hub.
- `POST /api/fits/quote-draft`
  - Price an unsaved draft at selected hub.
- `POST /api/fits/:id/send`
  - Create in-game fitting for selected pilot.
- `POST /api/fits/send-draft`
  - Create in-game fitting from an unsaved draft.

Quote routes remain explicit so the frontend can support manual Refresh Price and avoid repricing on unrelated save/edit operations.

## Frontend Architecture

Add:

- `web/src/components/FitsView.tsx`
- Fits API helpers and types in `web/src/api.ts`
- Top-level nav entry in `web/src/App.tsx` and `web/src/components/ControlPanel.tsx`
- Fits-specific CSS in `web/src/styles.css`

Core client state:

- Saved fit list.
- Selected saved fit ID.
- Unsaved draft, in memory only.
- Global hub selector, persisted in localStorage.
- Import modal state.
- Unmatched alert modal state.
- Selected pilot for in-game send, persisted in localStorage.
- Current quote result and loading/error state.

The frontend should not duplicate server resolution logic. It should render the normalized draft/detail returned by the API.

## Visual Design

Use the approved V1 mockup direction:

- Dark, dense, scan-friendly UI consistent with the rest of the app.
- Left library list at roughly 280-320 px.
- Right detail area with ship header and action bar.
- Slot sections shown as compact icon grids.
- Empty slots shown as dashed boxes.
- Resolved item icons use EVE image URLs, such as `https://images.evetech.net/types/{typeId}/icon?size=64`.
- Tooltip on hover shows item name and optional quantity/status.
- Warnings use restrained amber/red badges.
- Pricing totals sit in a right-side panel or summary card.

Do not use a marketing hero, large explanatory text, or decorative background elements.

## Error Handling

Import errors:

- Empty paste.
- Missing header.
- Multiple headers.
- Header ship not resolved.
- No parseable items.

Import warnings:

- Unmatched item names.
- Over-slot sections.
- Slot metadata missing for selected hull.
- Loaded charge could not be resolved.

Pricing errors:

- Hub invalid.
- No sellers for individual items.
- Partial fills.
- ESI/market fetch failures.

Send errors:

- Pilot missing `esi-fittings.write_fittings.v1`.
- No exportable items after filtering.
- Fit name too long for ESI; truncate safely or ask user to rename.
- More than 512 ESI fitting items.
- ESI validation or transient failure.

Unmatched item modal:

- Appears after preview when unmatched rows exist.
- Lists every unmatched raw item.
- Does not save anything.
- Lets the user continue inspecting the draft or return to edit the paste.

## Testing Strategy

Unit tests:

- Parse both provided Naglfar and Archon examples.
- Reject multiple fit headers.
- Parse duplicated modules as separate slot occupants.
- Parse cargo quantities with commas.
- Parse loaded charge lines with commas.
- Resolve known ship and item names.
- Preserve unmatched rows.
- Assign low/mid/high/rig/service/subsystem slots by section and hull layout.
- Produce over-slot warnings.
- Classify drones/fighters/cargo/extras.
- Generate normalized EFT text.
- Build ESI fitting payload with correct flags.
- Exclude unmatched/unassignable rows from ESI payload.
- Compute hull, fitted, extras, and grand totals from quote rows.

Route tests:

- Preview endpoint returns draft with warnings for unmatched rows.
- Save/list/get/update/delete saved fits.
- Quote endpoint returns expected totals with mocked market service.
- Send endpoint posts expected ESI payload with mocked ESI client.
- Missing fitting scope returns re-auth hint.

Frontend/manual verification:

- Import Naglfar example, see slot placeholders and cargo items.
- Import Archon example, see fighters/drones grouped appropriately.
- Override ship and see slot warnings recompute.
- Save manually and confirm library row appears.
- Refresh page and confirm saved fit persists, draft does not.
- Copy EFT and paste result into a text editor.
- Select pilot and send to in-game fittings after re-auth.
- Hover icons and confirm item-name tooltip.

## Open Decisions

No blocking V1 decisions remain.

Future versions can add tags, doctrine collections, killmail import, character skill readiness, fitting stats, and deeper Pyfa-style simulation.
