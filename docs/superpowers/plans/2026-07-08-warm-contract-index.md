# Warm Contract Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace on-demand public contract crawling with a warm SQLite-backed contract index so common ship/radius searches return from local data instead of timing out.

**Architecture:** Keep public ESI fetching in a background contract indexer that refreshes region pages and contract item rows using ESI cache expiry. The search route computes jump distance locally, prioritizes relevant regions for refresh, and returns indexed results immediately with freshness/coverage metadata. React keeps the same search form but shows index-warming/staleness information instead of treating slow ESI crawls as the user request.

**Tech Stack:** TypeScript, Node 22 test runner, Fastify, React 18, Vite, `better-sqlite3`, local `.cache/sde.zip`, EVE ESI public contracts endpoints.

## Global Constraints

- Contracts v1 uses public ESI endpoints only and adds no new EVE SSO scopes.
- Default radius remains 30 jumps.
- Accepted radius range remains 1 to 100 jumps.
- User searches must not crawl ESI synchronously.
- Background indexing keeps public contracts warm even when nobody is actively searching.
- Search includes only public `item_exchange` and `auction` contracts.
- Search matches only included contract items where `type_id === selectedShipTypeId`, `is_included === true`, and `quantity > 0`.
- Expired contracts are not returned.
- Known-location contracts outside the requested radius are not returned.
- Unknown-location contracts from touched regions are visible but sort after known-distance rows and render `jumps` as `null`.
- Public contract pages and item rows use ESI `Expires` where available, with a 5 minute fallback TTL.
- Region contract page fetch concurrency is 3 inside a region refresh.
- Contract item fetch concurrency is 8 inside item refresh.
- The map topology is loaded once per server process from `.cache/sde.zip`.
- Missing `.cache/sde.zip` returns a clear setup error telling the user to run `npm run build:mastery`.

---

## File Structure

- Modify `src/db.ts`: create contract index tables and indexes.
- Create `src/contracts/index-store.ts`: SQLite persistence, indexed search query, freshness status, and region prioritization.
- Create `src/contracts/index-store.test.ts`: in-memory SQLite tests for schema, upsert, search, and coverage metadata.
- Create `src/contracts/indexer.ts`: background refresh loop, region/page refresh, item refresh, and lifecycle hooks.
- Create `src/contracts/indexer.test.ts`: fake ESI tests for region refresh and priority work selection.
- Modify `src/contracts/search.ts`: make `runContractSearch` read indexed data and queue priority refresh work instead of live crawling ESI.
- Modify `src/contracts/search.test.ts`: replace live-crawl orchestration cases with indexed-search behavior.
- Modify `src/routes/contracts.ts`: expose indexed search metadata and keep route cancellation for request lifecycle only.
- Modify `src/routes/contracts.test.ts`: assert indexed route response includes index metadata and returns immediately.
- Modify `src/server.ts`: start the warm contract indexer after route registration.
- Modify `web/src/api.ts`: add contract index metadata types.
- Modify `web/src/components/ContractsView.tsx`: remove hard timeout messaging and render index warming/stale coverage messages.
- Modify `README.md`: document the warm contract index behavior.

---

### Task 1: Contract Index Store

**Files:**
- Modify: `src/db.ts`
- Create: `src/contracts/index-store.ts`
- Create: `src/contracts/index-store.test.ts`

**Interfaces:**
- Produces:
  - `migrateContractIndexDb(database): void`
  - `upsertContractIndexRegions(database, regions, now): void`
  - `upsertRegionContracts(database, input): void`
  - `replaceContractItems(database, contractId, items, fetchedAt, expiresAt): void`
  - `searchIndexedContracts(database, input): IndexedContractSearch`
  - `getContractIndexCoverage(database, regionIds, now): ContractIndexCoverage`
  - `prioritizeContractRegions(database, regionIds, now): void`
  - `nextContractRegionToRefresh(database, now): IndexedRegionWork | null`

- [ ] **Step 1: Write failing store tests**

Cover an in-memory database with these behaviors:
- migration creates tables;
- search returns only matching included positive-quantity ship items;
- known out-of-radius contracts are excluded;
- unknown-location contracts in touched regions are included with `jumps: null`;
- coverage reports ready, stale, and never-indexed regions;
- prioritization makes a region eligible for refresh.

- [ ] **Step 2: Run store tests and verify RED**

Run: `npm test -- src/contracts/index-store.test.ts`

Expected: FAIL because `src/contracts/index-store.ts` does not exist.

- [ ] **Step 3: Implement schema and store functions**

Add contract tables to `src/db.ts` through `migrateContractIndexDb(db)`. Keep the functions pure over a passed `better-sqlite3` database so tests can use `:memory:`.

- [ ] **Step 4: Run store tests and verify GREEN**

Run: `npm test -- src/contracts/index-store.test.ts`

Expected: PASS.

---

### Task 2: Warm Indexer

**Files:**
- Create: `src/contracts/indexer.ts`
- Create: `src/contracts/indexer.test.ts`

**Interfaces:**
- Consumes store functions from Task 1.
- Produces:
  - `refreshContractRegion(input): Promise<ContractRegionRefreshResult>`
  - `refreshDueContractRegion(input): Promise<ContractRegionRefreshResult | null>`
  - `startContractIndexer(options?): { stop(): void; kick(): void }`

- [ ] **Step 1: Write failing indexer tests**

Cover:
- region refresh fetches all pages, upserts summaries, marks removed contracts inactive, and fetches items for active contracts;
- item fetch failures do not fail the whole region refresh;
- `refreshDueContractRegion` picks prioritized due work and returns `null` when no work is due.

- [ ] **Step 2: Run indexer tests and verify RED**

Run: `npm test -- src/contracts/indexer.test.ts`

Expected: FAIL because `src/contracts/indexer.ts` does not exist.

- [ ] **Step 3: Implement indexer**

Use `getPublicContracts` and `getPublicContractItems` by default, page concurrency 3, item concurrency 8, ESI expiry from wrappers, and a single background loop that refreshes one due region at a time.

- [ ] **Step 4: Run indexer tests and verify GREEN**

Run: `npm test -- src/contracts/indexer.test.ts`

Expected: PASS.

---

### Task 3: Indexed Search Service And Route

**Files:**
- Modify: `src/contracts/search.ts`
- Modify: `src/contracts/search.test.ts`
- Modify: `src/routes/contracts.ts`
- Modify: `src/routes/contracts.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes store/indexer from Tasks 1-2.
- Produces `ContractSearchResponse.index` with coverage counts and freshness timestamps.

- [ ] **Step 1: Write failing search and route tests**

Cover:
- `runContractSearch` reads from the index without calling ESI fetch dependencies;
- it prioritizes touched regions for refresh;
- response includes coverage metadata and an index-warming warning when region coverage is incomplete;
- route returns indexed data immediately.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/contracts/search.test.ts src/routes/contracts.test.ts`

Expected: FAIL because the current implementation still expects live ESI fetch dependencies and lacks index metadata.

- [ ] **Step 3: Implement indexed search and route wiring**

Replace synchronous ESI crawl in `runContractSearch` with indexed lookup. Start `startContractIndexer()` from `src/server.ts` after `bootstrapSystemsCache()` is scheduled.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- src/contracts/search.test.ts src/routes/contracts.test.ts`

Expected: PASS.

---

### Task 4: UI And Documentation

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/components/ContractsView.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes `ContractSearchResponse.index`.
- Produces warming/stale messages in the Contracts tab.

- [ ] **Step 1: Update frontend types and UI**

Remove the hard 30 second client timeout. Show index coverage such as “Index warming: 12 of 54 regions ready” and stale-region warnings from the API response.

- [ ] **Step 2: Update README**

Document that contract searches use a warm local SQLite index and may return partial results while the index is warming.

- [ ] **Step 3: Run final verification**

Run:
- `npm test`
- `npm run typecheck`
- `npm run build`

Expected: all pass.

- [ ] **Step 4: Restart local dev server**

Run: `npm run dev`

Expected: app opens at `http://localhost:5173/` with API at `http://127.0.0.1:3100`.

