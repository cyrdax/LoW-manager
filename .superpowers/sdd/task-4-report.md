# Task 4 Report: Private Assets API Routes And Runtime Wiring

## Status

DONE

## Commit

- `9720945 fix: return complete asset rosters`

## Delivered

- Added `src/routes/assets.ts` with authenticated cached dashboard reads, per-pilot refresh, and refresh-all endpoints.
- Scoped every route to the authenticated app user. Per-pilot refresh performs an owned-character lookup; refresh-all starts from usable owned pilots.
- Passed the injected `characters` store as `characterStore` to both refresh services for Task 3's authoritative ownership validation.
- Added `esi-assets.read_assets.v1` to future SSO scopes.
- Wired the PostgreSQL asset snapshot store and assets route registration into `src/server.ts`.
- Added route/runtime tests, including cached user-only reads, no GET refresh call, auth, ownership, and character-store forwarding.

## TDD Evidence

1. Added `src/routes/assets.test.ts` and the runtime wiring expectations before the route implementation.
2. Ran `node --import tsx --test src/routes/assets.test.ts src/server-postgres-runtime-view.test.ts`.
   - Result: expected failure: `ERR_MODULE_NOT_FOUND` for `src/routes/assets.ts`; the new runtime wiring assertions also failed because the server had not been updated.
3. Implemented the routes, scope, runtime wiring, and authoritative `characterStore` forwarding.
4. Re-ran the focused command.
   - Result: 6 passed, 0 failed.

## Verification

- `node --import tsx --test src/routes/assets.test.ts src/server-postgres-runtime-view.test.ts`
  - Result: 6 passed, 0 failed.
- `npm test`
  - Result: 229 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

## Self-Review

- Confirmed `GET /api/assets` only reads snapshots for the current user and never invokes either refresh dependency.
- Confirmed refresh routes require authentication, use owned/usable character queries, and return refreshed dashboard data.
- Confirmed both refresh service calls receive the authoritative character-store boundary required by Task 3 before any ESI/token-dependent activity.
- Confirmed runtime uses the Postgres asset snapshot store alongside the shared Postgres character store.
- Kept tracked edits confined to the Task 4 files.

## Concerns

- The eight skipped full-suite tests require external Postgres environment variables and are unrelated to Task 4.

---

# Task 4 Follow-up Fix Report: Complete Asset Rosters And Route Validation

## Status

DONE

## Fixed Review Findings

- `GET /api/assets` now merges every authenticated user's character from `listByUser(user.id)` with that user's cached snapshots. Pilots without a snapshot receive a read-only empty placeholder with `Needs re-auth`, `Missing asset scope`, or `Needs refresh` status as appropriate.
- `POST /api/assets/refresh` now refreshes usable owned pilots, reloads snapshots, rebuilds the complete roster, and uses that exact roster for both `pilots` and `dashboard`.
- Per-character refresh validates canonical positive safe-integer IDs before querying ownership and returns `{ error: 'invalid_character_id' }` with HTTP 400 for malformed values.
- Expanded route tests cover all three unauthenticated routes without dependency execution, exact authenticated user arguments for character-store calls, cross-account snapshot exclusion, no-snapshot placeholders, and invalid IDs.

## Verification

- `node --import tsx --test src/routes/assets.test.ts src/server-postgres-runtime-view.test.ts`
  - Result: 7 passed, 0 failed.
- `npm test`
  - Result: 230 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

## Self-Review

- Confirmed unauthenticated requests return before invoking stores, character queries, or refresh services.
- Confirmed roster construction reads only existing state and never invokes ESI or persistence during GET.
- Confirmed cached snapshots remain user-scoped and are emitted only for characters owned by the authenticated user's roster.
- Confirmed refresh-all returns dashboard totals and pilot rows from the same reloaded merged collection.
- Confirmed malformed character IDs do not reach `getOwned`.

## Concerns

- The eight skipped full-suite tests require external Postgres environment variables and are unrelated to this route fix.

---

# Task 4 Follow-up Fix Report: Overlay Current Character Authorization

## Status

DONE

## Commit

- `5fd1591 fix: overlay current asset authorization status`

## Fixed Review Finding

- `mergeAssetRoster` now overlays current character authorization on cached snapshots: `Needs re-auth` takes precedence when `needs_reauth === 1`, and `Missing asset scope` is shown when `esi-assets.read_assets.v1` is absent.
- Cached locations, categories, values, and `lastRefreshedAt` remain unchanged.
- GET and refresh-all responses use the same authorization-aware roster, so refresh-all `pilots` and `dashboard.pilots` stay consistent.
- Added regressions for cached `Ready` snapshots becoming `Missing asset scope` and `Needs re-auth`, including refresh-all dashboard consistency.

## Verification

- `node --import tsx --test src/routes/assets.test.ts src/server-postgres-runtime-view.test.ts`
  - Result: 9 passed, 0 failed.
- `npm test`
  - Result: 230 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured for Postgres integration tests.
- `npm run typecheck`
  - Result: passed with exit code 0.
- `git diff --check`
  - Result: passed with no output.

## Self-Review

- Confirmed re-authentication takes precedence over missing scope for cached and placeholder roster entries.
- Confirmed authorized characters retain cached status, while unauthorized characters receive the current authorization status without losing cached asset data or refresh timestamps.
- Confirmed refresh-all rebuilds one merged roster and passes it to both response fields.
- Confirmed tracked implementation edits remained confined to `src/routes/assets.ts`, `src/routes/assets.test.ts`, and this report.

## Concerns

- The eight skipped full-suite tests require external Postgres environment variables.
