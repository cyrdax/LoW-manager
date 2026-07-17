# Task 3 Report: ESI Asset Refresh Service

## Status

DONE

## Implementation Commit

- `f52038a feat: refresh cached pilot assets`

## Delivered

- Added authenticated, paginated character asset retrieval in `src/esi/assets.ts`.
- Added manual asset refresh orchestration in `src/assets/refresh.ts`.
- Enforced the missing-scope and needs-reauth status paths before any ESI asset call.
- Added default metadata and location resolution, Jita price aggregation by type ID, snapshot construction, persistence, bounded multi-pilot refresh, and dashboard summaries.
- Added focused refresh tests in `src/assets/refresh.test.ts`.

## TDD Evidence

1. Added `src/assets/refresh.test.ts` before either production module existed.
2. Ran `node --import tsx --test src/assets/refresh.test.ts`.
   - Result: expected failure, `ERR_MODULE_NOT_FOUND` for `src/assets/refresh.ts`.
3. Implemented `src/esi/assets.ts` and `src/assets/refresh.ts`.
4. Re-ran the focused command.
   - Result: 5 passed, 0 failed.

## Verification

- `node --import tsx --test src/assets/refresh.test.ts`
  - Result: 5 passed, 0 failed.
- `npm test`
  - Result: 218 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

## Self-Review

- Verified status guards return persisted snapshots and do not invoke the asset fetcher.
- Verified asset type pricing is grouped before quote requests and maps `avgPrice` to per-stack unit values; absent/no-order prices remain unpriced.
- Verified root locations are resolved only for non-contained assets, preserving the item containment tree built by Task 2.
- Verified `refreshAllAssets` retains input order while bounding concurrent refreshes.
- Kept edits scoped to the three Task 3 files.

## Concerns

- None. The skipped integration tests require external Postgres environment variables and are unrelated to this Task 3 implementation.

## Review Fix Report

### Fixes

- Enforced `character.user_id === userId` before refresh status checks, ESI calls, pricing, structure lookup, or persistence. Bulk refresh now validates every character before dispatching a custom or default refresher.
- Carried ESI `is_blueprint_copy` into normalized assets, excluded copies from market quote batches, and left copies unpriced.
- Preserved cached snapshot JSON and its last successful refresh timestamp whenever a re-auth, missing-scope, or refresh-error status is recorded. Empty status snapshots are still created when none exist.
- Isolated root location resolution failures so each failed root becomes `Unknown location <id>` with unresolved status. Contained item location IDs remain excluded from root resolution.

### Added Regression Coverage

- Cross-user refresh is rejected before ESI or snapshot writes.
- Blueprint copies are not quoted and are unpriced.
- Cached snapshots survive both lost asset scope and a caught ESI refresh error.
- Failed root station resolution falls back without preventing other roots from loading.
- Item container IDs are not sent to the location resolver.
- SQLite and Postgres snapshot-store status paths retain the prior refresh timestamp.

### Verification

- `node --import tsx --test src/assets/refresh.test.ts`
  - Result: 11 passed, 0 failed.
- `npm test`
  - Result: 224 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

### Self-Review

- Confirmed ownership rejection performs no store write and cannot reach the ESI fetcher, including through `refreshAllAssets` with a supplied `refreshOne`.
- Confirmed status persistence updates only pilot status/error while retaining cached locations, values, and the last successful refresh timestamp.
- Confirmed a rejected location resolver is isolated to its root location and does not turn the complete refresh into an error.
- Kept the change scoped to Task 3 asset refresh, persistence/type support, tests, and this report.

## Review Fix Report: Shared Blueprint Type IDs

### Fixes

- Forced blueprint copies to `{ unitValue: null, pricingStatus: 'unpriced' }` while constructing snapshot asset inputs, before consulting the type-price map.
- Added `blueprintCopy` to emitted `AssetTreeNode` objects so the marker survives in stored snapshots.
- Updated the regression test so a blueprint copy and original share `typeId: 100`; it verifies the copy is unpriced, the original is priced, and the stored copy retains its marker.

### Verification

- `node --import tsx --test src/assets/refresh.test.ts src/assets/tree.test.ts`
  - Result: 16 passed, 0 failed.
- `npm test`
  - Result: 224 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

### Self-Review

- Confirmed copies are excluded from quote requests and cannot inherit a same-type original's market price.
- Confirmed original assets sharing a type ID remain priced normally.
- Confirmed the boolean marker is present on returned tree nodes and survives the snapshot store round trip.
- Kept edits scoped to asset types, tree/refresh behavior, the regression test, and this report.

### Concerns

- The eight skipped full-suite tests require external Postgres environment variables and are unrelated to this fix.

## Review Fix Report: Authoritative Refresh Ownership and Atomic Status Writes

### Fixes

- Made `characterStore.getOwned(userId, characterId)` a required refresh dependency. `refreshPilotAssets` resolves the authoritative character before any status persistence, ESI fetch, token-dependent call, pricing, or location resolution, and uses that row for all subsequent work.
- Made `refreshAllAssets` perform the same authoritative lookup before calling either a custom `refreshOne` function or the default refresher.
- Replaced the Postgres status read-then-write with one `INSERT ... ON CONFLICT DO UPDATE` statement. Existing snapshot JSON is patched in-place for pilot name/status/error and retains its existing `last_refreshed_at`, preventing a status update from replacing a newer refresh snapshot.
- Normalized bulk concurrency so only finite positive values are used; `NaN`, infinities, zero, and negative values use the safe default of three workers.

### Added Regression Coverage

- Forged `CharacterRow` data is rejected without invoking ESI or writing a snapshot when `getOwned` returns no row.
- Bulk refresh rejects an unowned input before delegating to a supplied custom refresher.
- A needs-re-auth status preserves an already cached snapshot and last successful refresh timestamp.
- Non-finite concurrency falls back to the default worker count.
- Postgres status persistence is asserted to use one atomic query, preserve the existing timestamp, patch the current JSON snapshot, and bind the expected ownership/status parameters.

### Verification

- `node --import tsx --test src/assets/refresh.test.ts src/assets/store.test.ts`
  - Result: 19 passed, 0 failed.
- `npm test`
  - Result: 225 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

### Self-Review

- Confirmed unauthoritative caller rows cannot trigger ESI, status writes, custom refresh delegation, pricing, or location resolution.
- Confirmed the authoritative row supplies scopes, re-auth state, ID, and name for all refresh paths.
- Confirmed the Postgres conflict update derives its JSON and timestamp from the current database row rather than a stale client read.
- Kept the public refresh input shape otherwise intact; callers now must provide the existing character-store ownership boundary for secure behavior.
