# Assets View Design

## Goal

Build a private Assets tab that lets a logged-in user inspect character-owned assets across all of their authenticated EVE pilots. The view should summarize total inventory value and broad asset categories at the top, then provide a searchable expandable tree from pilot to location to nested assets.

## Scope

V1 includes character-owned assets only. Corporation assets are out of scope.

All asset data is private to the logged-in account. There is no public or shareable asset mode.

The feature uses cached Postgres snapshots and manual refresh. It does not automatically refresh ESI data when the page loads.

The existing Pilots table is unchanged in v1.

## Navigation

Add `Assets` to the main sidebar between `Fits` and `Market`.

The resulting order is:

1. `Pilots`
2. `Fleet`
3. `Fits`
4. `Assets`
5. `Market`
6. `Contracts`
7. `Industry`
8. `Planets`

## User Experience

The Assets view has three areas.

### Dashboard

The top dashboard summarizes all cached asset snapshots for the current account:

- `Total Estimated Value`
- `Priced Value`
- `Unpriced Stacks`
- `Last Refresh`
- Category cards

Category cards are built from broad asset categories such as:

- `Ships`
- `Frigates`
- `Cruisers`
- `Battleships`
- `Capitals`
- `Mining Ships`
- `Modules`
- `Armor Modules`
- `Shield Modules`
- `Scanning Equipment`
- `CPU/Powergrid Upgrades`
- `Weapon Upgrades`
- `Implants`
- `Drones/Fighters`
- `Ammo`
- `Materials`
- `Minerals`
- `PI`
- `Blueprints`
- `Other`

Each card shows:

- Item count
- Stack count
- Estimated value

Category cards are clickable filters for the tree below. `All assets` clears the category filter. Cards are sorted by estimated value descending after pinned high-level groups such as `Ships`, `Modules`, and `Materials`.

### Controls

Controls include:

- `Refresh All`
- Per-pilot refresh buttons
- Global search
- Active category filter state
- Stale-data messaging

Snapshots older than 24 hours are marked `Stale`. Stale snapshots are still displayed until the user refreshes them.

### Expandable Tree

The main table is an expandable tree:

1. Pilot rows
2. Location rows under pilots
3. Asset/container/ship rows under locations and parents

Pilot rows show:

- Pilot name
- Status
- Estimated asset value
- Stack count
- Location count
- Last refresh time

Location rows show:

- Location name
- Location type/status
- Estimated value including nested contents
- Stack count
- Raw location ID when unresolved

Asset rows show:

- `Name`
- `Category`
- `Qty`
- `Unit Value`
- `Total Value`
- `Container/Parent`
- `Status`

Use EVE item icons on expanded asset rows and useful category cards. Keep pilot and location headers text-first so the tree remains dense and scannable.

Search matches pilots, locations, containers, item names, and categories. Parent rows stay visible when a descendant matches.

## Backend Data Flow

Add a private `/api/assets` route family. Every route requires an authenticated app user and only returns data for pilots owned by that user.

Refresh flow:

1. User clicks `Refresh All` or a per-pilot refresh.
2. Server checks pilot ownership and usable auth state.
3. Server checks the pilot has `esi-assets.read_assets.v1`.
4. Server calls ESI `GET /characters/{character_id}/assets/`.
5. Server resolves item type names, groups, and categories from bundled/Fuzzwork metadata where possible.
6. Server resolves known station/system locations.
7. Server attempts structure name resolution where permitted by ESI.
8. Unresolvable structures become `Unknown structure` with the raw location ID and an `unresolved` status.
9. Server builds a nested asset tree from ESI `location_id` parent relationships.
10. Server prices marketable stacks using existing Jita pricing logic.
11. Server stores a processed snapshot in Postgres.
12. UI reads cached snapshots quickly.

`Refresh All` supports all usable pilots, but the server limits refresh concurrency so one slow or failing pilot does not block every other pilot.

## Auth And Scopes

Add `esi-assets.read_assets.v1` to future EVE SSO authorization.

Existing pilots without that scope remain visible in the Assets view but show `Missing asset scope` until re-authenticated.

Statuses used by the feature:

- `Ready`
- `Refreshing`
- `Needs refresh`
- `Stale`
- `Missing asset scope`
- `Needs re-auth`
- `Error`

## Categorization

Categories are built-in for v1 and are not user-editable.

The app derives categories from EVE category, group, and type metadata where possible, with a small app-owned override map for practical dashboard buckets such as `Scanning Equipment` and `CPU/Powergrid Upgrades`.

Every asset maps to one primary dashboard category. Some ship categories also roll up into the parent `Ships` card. The implementation must avoid double-counting in total value: parent rollups are for display only, while global totals count each asset stack once.

## Valuation

Default valuation hub is Jita.

Pricing reuses the existing market order walk logic where possible:

- Cheapest sell orders first
- Jita system-filtered orders
- Partial and no-order states preserved

Asset row value is only that stack.

Pilot, location, category, and dashboard values include nested contents.

Unpriced and non-market assets remain visible with `unpriced` status. They count toward item/stack totals but not estimated value.

The dashboard should expose priced and unpriced counts so users can tell how complete the valuation is.

## Persistence

Postgres stores processed snapshots by user and pilot. Snapshot data must include enough information for fast UI reads:

- Pilot identity and refresh status
- Last refresh timestamp
- Locations
- Parent/child asset relationships
- Type IDs, names, categories, quantities, singleton flag/status
- Unit and total values where priced
- Pricing status
- Unresolved location status

The exact table shape can be normalized or JSON-backed, but it must support:

- User-scoped reads
- Replacing one pilot snapshot atomically after refresh
- Listing all snapshots for the current account
- Detecting stale snapshots older than 24 hours

## API Shape

The implementation plan should define exact request and response types, but v1 needs these operations:

- List current account asset snapshots and dashboard aggregate.
- Refresh one owned pilot.
- Refresh all usable owned pilots with server-side concurrency limiting.

Errors should return clear re-auth or missing-scope hints when ESI rejects asset reads.

## Testing

Add tests for:

- Category mapping for representative ships, modules, implants, materials, blueprints, and unknown items.
- Nested asset tree construction from ESI `location_id` relationships.
- Aggregate totals without double-counting nested contents.
- Stale status after 24 hours.
- Missing `esi-assets.read_assets.v1` detection.
- User-scoped route reads.
- Per-pilot and refresh-all route behavior.
- Location fallback to `Unknown structure`.
- Frontend structure for dashboard cards, refresh controls, global search, and expandable pilot/location/asset tree.

Run the full existing test suite before committing implementation work.
