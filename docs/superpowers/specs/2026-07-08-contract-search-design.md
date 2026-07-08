# Contract Search Tab Design

## Context

Legion of Wayne Manager already has top-level sidebar views for Pilots, Planets, Skills, Fleet, Market, and Industry. Market and Industry use a server-side Fastify API to keep ESI calls, SDE-derived metadata, pricing math, and cache behavior out of the React client. The new Contracts tab should follow that pattern: the browser gathers search intent and renders results; the server resolves ship/system metadata, talks to ESI, computes routes, and returns a compact result set.

Public ESI contract data is region-scoped. The public contract list gives contract metadata, while contract contents require a separate `/contracts/public/items/{contract_id}/` call. The app already bundles SDE-derived ship data in `data/eve-mastery.json` and already has a cached system-name search table. The local SDE zip also includes universe YAML files with stargate links, so jump-distance math can be done locally instead of calling ESI's route endpoint for every result.

## Goal

Add a Contracts top-level tab that lets the user search by ship name and origin system, then returns public item-exchange and auction contracts containing that ship within a default radius of 30 jumps.

## Non-Goals

- Creating, accepting, bidding on, or deleting contracts.
- Reading private character contracts or corporation contracts.
- Searching courier contracts.
- Full-text search across all contract titles.
- Real-time background indexing of every public contract in New Eden.
- Wormhole-chain routing, Thera rolling route logic, or user-managed temporary connections.

## User Experience

The Contracts tab is a work-focused search surface, visually aligned with the Market and Industry views.

The top search band contains:

- Ship search autocomplete, backed by bundled SDE ship data.
- Origin system autocomplete, backed by the existing `/api/search/systems` route.
- Radius input or segmented selector, defaulting to 30 jumps and allowing smaller/larger values.
- A Search button and refresh control.

The result summary shows:

- Selected ship and type ID.
- Origin system.
- Radius.
- Matching contract count.
- Regions scanned.
- Result freshness timestamp.
- Partial-result warnings when any ESI calls fail.

The results table is sorted by `jumps ASC`, then effective price ascending. Columns:

- Ship.
- Contract type: item exchange or auction.
- Price: item-exchange price, auction buyout when present, otherwise the auction price field returned by the public contract list.
- Quantity of selected ship included in the contract.
- Location: system name plus station/structure label when known.
- Jumps from origin.
- Expiry.
- Title.
- Contract ID.

Rows with unknown location system are still shown, but jumps render as `unknown` and sort after known-distance rows. Rows for expired contracts are not returned.

## Search Semantics

The user selects one exact ship type from autocomplete. The backend filters contract items by:

- `type_id === selectedShipTypeId`
- `is_included === true`
- `quantity > 0`

The backend only searches public contracts whose `type` is:

- `item_exchange`
- `auction`

The first implementation treats contracts as a match if at least one included item row is the selected ship. If a contract contains multiple matching ship stacks, quantities are summed into one result row for that contract.

## Backend Architecture

Add a new route module, `src/routes/contracts.ts`, and register it in `src/server.ts`.

Server endpoints:

- `GET /api/contracts/ships?q=<query>`: ship autocomplete, reusing `loadMasteryData().ships`.
- `GET /api/contracts/search?shipId=<id>&originSystemId=<id>&radius=<n>`: public contract search.

Add an ESI wrapper module, `src/esi/contracts.ts`, with typed helpers for:

- `getPublicContracts(regionId, page)`
- `getPublicContractItems(contractId)`

Add a map/topology module, `src/contracts/map.ts`, responsible for:

- Loading K-space region, constellation, and solar-system metadata from `.cache/sde.zip`.
- Building a system adjacency map from solarsystem `stargates`.
- Mapping each solar system to its region.
- Computing shortest jump distances from an origin with breadth-first search.
- Returning the set of region IDs that contain at least one system within the requested radius.

Add a contract search service, `src/contracts/search.ts`, responsible for:

- Validating requested ship and origin.
- Calling map topology to get reachable systems and relevant regions.
- Fetching public contracts for those regions page by page.
- Filtering contract metadata by type and expiry.
- Fetching item rows only for plausible contracts.
- Filtering item rows for the selected ship.
- Resolving location system and display names where possible.
- Returning sorted, compact result objects and warnings.

## Data Flow

1. Browser requests ship suggestions as the user types.
2. Browser requests system suggestions through the existing system search API.
3. Browser submits `shipId`, `originSystemId`, and `radius`.
4. Server validates the ship exists in bundled SDE data.
5. Server computes shortest jump distances from the origin using local SDE topology.
6. Server identifies regions that intersect the radius.
7. Server fetches public contract pages for those regions.
8. Server filters to active item-exchange and auction contracts.
9. Server fetches item rows for remaining contracts with bounded concurrency.
10. Server keeps contracts that include the selected ship.
11. Server resolves each contract location to a solar system when possible.
12. Server attaches `jumps` from the precomputed distance map.
13. Server returns results sorted by jumps and effective price.

## Location Resolution

ESI public contracts expose location identifiers, but public structure names and some structure-to-system mappings can be incomplete from a public-only perspective.

The implementation should resolve locations in this order:

1. If the contract metadata includes a usable system ID, use it directly.
2. If the start location is an NPC station ID, resolve the station's system through local SDE station metadata.
3. If the location is a player structure and a known system cannot be derived, keep the contract with `locationKnown: false`.
4. If a structure name can be resolved later through an authenticated pilot, cache and display it, but do not block v1 on that capability.

Unknown-location contracts are visible because they may still be useful, but they are excluded from the within-radius count and sort after known-distance matches.

## Caching and Rate Limits

Public contract pages and item rows should be cached in memory using ESI `Expires` where available, with a conservative fallback TTL of 5 minutes.

Concurrency limits:

- Region contract page fetches: 3 concurrent regions.
- Contract item fetches: 8 concurrent contracts.

The route returns partial results when individual region/page/item fetches fail. Warnings include counts and short labels, not raw ESI response bodies.

The map topology is loaded once per server process and kept in memory. If `.cache/sde.zip` is missing, the Contracts tab returns a clear setup error telling the user to run the existing SDE refresh/build workflow.

## API Response Shape

`GET /api/contracts/ships?q=bargh`

```json
[
  { "id": 17920, "name": "Barghest", "groupName": "Battleship" }
]
```

`GET /api/contracts/search?shipId=17920&originSystemId=30000142&radius=30`

```json
{
  "ship": { "id": 17920, "name": "Barghest", "groupName": "Battleship" },
  "origin": { "id": 30000142, "name": "Jita" },
  "radius": 30,
  "regionsScanned": [
    { "id": 10000002, "name": "The Forge" }
  ],
  "fetchedAt": 1783526400000,
  "results": [
    {
      "contractId": 123456789,
      "type": "item_exchange",
      "title": "Barghest fitted",
      "price": 1400000000,
      "buyout": null,
      "effectivePrice": 1400000000,
      "quantity": 1,
      "shipTypeId": 17920,
      "shipName": "Barghest",
      "regionId": 10000002,
      "regionName": "The Forge",
      "systemId": 30000142,
      "systemName": "Jita",
      "locationName": "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
      "locationKnown": true,
      "jumps": 0,
      "dateIssued": "2026-07-08T12:00:00Z",
      "dateExpired": "2026-07-15T12:00:00Z"
    }
  ],
  "warnings": []
}
```

## Frontend Architecture

Add `web/src/components/ContractsView.tsx` and render it from `web/src/App.tsx` when `view === 'contracts'`.

Add API helpers and types to `web/src/api.ts`:

- `searchContractShips(q, signal)`
- `searchContracts(params, signal)`
- `ContractSearchResult`
- `ContractSearchResponse`

Update `web/src/components/ControlPanel.tsx`:

- Add Contracts to the sidebar view nav.
- Add concise Contracts help text in the sidebar only when active.

Persist Contracts UI state in localStorage:

- `efd.contracts.shipId`
- `efd.contracts.shipName`
- `efd.contracts.originSystemId`
- `efd.contracts.originSystemName`
- `efd.contracts.radius`

The Contracts view should use the existing visual language from Market/Industry: compact controls, dense tables, restrained badges, and scan-friendly numeric columns.

## Error Handling

Frontend states:

- Empty: no search submitted yet.
- Loading: search is running.
- No results: search completed with zero matches.
- Partial: results returned with warnings.
- Error: validation failure, missing SDE topology, or full ESI failure.

Backend validation errors:

- Ship ID is missing or not a known bundled ship.
- Origin system ID is missing or not present in topology.
- Radius is outside the accepted range of 1 to 100.

ESI errors:

- Region/page failures produce partial warnings.
- Item-row failures produce partial warnings.
- ESI error-limit throttling is handled by the existing ESI client.

## Testing Strategy

Unit tests:

- Map topology BFS returns expected jump distances on a small synthetic graph.
- Region selection includes every region with at least one reachable system.
- Contract item filtering keeps only included rows for the selected ship.
- Sorting puts known jump counts before unknown locations and sorts price within equal jumps.
- Radius validation clamps or rejects invalid values according to route schema.

Route tests:

- Ship autocomplete returns prefix matches before substring matches.
- Contract search returns normalized results for mocked public contracts and item rows.
- Partial ESI failure returns warnings without dropping successful matches.
- Missing topology returns a clear setup error.

Manual verification:

- Search `Barghest` from `Jita` with radius `30`.
- Search a common hull from `Amarr` and confirm results sort by jumps.
- Search an uncommon hull and confirm the no-results state is clear.
- Confirm browser state persists after switching tabs and reloading.

## Rollout

The feature is additive. It introduces no new EVE SSO scopes because v1 uses public contract endpoints and existing local SDE data. Existing authenticated character flows are unchanged.

The first release should document that public player-structure locations may show as unknown and that results are scoped to public item-exchange and auction contracts.
