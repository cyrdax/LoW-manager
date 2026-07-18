# Task 4 Report: Private Assets API Routes And Runtime Wiring

## Status

DONE

## Commit

- `38a0393 feat: add private assets api`

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
