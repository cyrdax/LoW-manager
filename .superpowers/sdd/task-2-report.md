# Task 2 Report: Asset Snapshot Persistence

## Status

DONE

## Implementation

- Added `src/assets/store.ts` with the shared `AssetSnapshotStore` contract and SQLite/Postgres factories.
- Added SQLite migration support for `asset_snapshots` and user-scoped replace, list, status-only record, and delete operations.
- Added Postgres persistence using `asset_snapshots`, scoped by `user_id` for list and delete queries.
- Marked ready snapshots older than `ASSET_STALE_MS` (24 hours) as `Stale` when listing while retaining them in results.
- Added the Postgres `asset_snapshots` table with `app_users(id)` and `characters(character_id)` cascading foreign keys.
- Added focused store tests and migration assertions.

## TDD Evidence

1. `node --import tsx --test src/assets/store.test.ts src/db/migrations.test.ts`
   - Initial red run failed as expected: `src/assets/store.ts` and the `asset_snapshots` migration table did not exist.
2. Implemented the store and schema.
3. Re-ran `node --import tsx --test src/assets/store.test.ts src/db/migrations.test.ts`
   - Passed: 8 tests, 0 failures.

## Verification

- `node --import tsx --test src/assets/store.test.ts src/db/migrations.test.ts`
  - Passed: 8 tests, 0 failures.
- `npm test`
  - Passed: 207 tests, 0 failures; 8 Postgres integration tests skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured.
- `npm run typecheck`
  - Passed.
- `git diff --check`
  - Passed with no output.

## Self-Review

- All queries that read or remove snapshots include `user_id` filtering; composite keys also prevent cross-user replacement.
- The migration uses the corrected `app_users(id)` foreign key and `characters(character_id)` as required.
- Staleness is a non-destructive presentation-time status change, so old snapshots remain listable.
- The focused tests exercise user isolation, replacement, stale status, status-only records, and schema foreign keys.

## Commit

- `3f9b709 feat: store cached asset snapshots`

## Concerns

- Live Postgres integration tests were not run because the required database environment variables are unavailable locally. The Postgres SQL is covered by typecheck and the migration assertion, but not against a live database in this worktree.

## Fix Follow-up

### Changes

- Restored `0001_multi_tenant_foundation.sql` to its Task 1 schema and moved asset snapshots into `0002_asset_snapshots.sql`.
- Added a composite Postgres foreign key from `asset_snapshots(user_id, character_id)` to `characters(user_id, character_id)`, backed by a unique constraint, while retaining the `app_users(id)` foreign key.
- Made SQLite snapshot rows use the same composite character ownership foreign key and enabled foreign-key enforcement during migration.
- Cleared `last_refreshed_at` in both SQLite and Postgres status-only conflict updates.
- Added focused coverage for ownership mismatch rejection, user-scoped deletion, JSONB object/string parsing, and refresh timestamp clearing.

### Verification

- `node --import tsx --test src/assets/store.test.ts src/db/migrations.test.ts`
  - Passed: 12 tests, 0 failures.
- `npm test`
  - Passed: 211 tests, 0 failures; 8 Postgres integration tests skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured.
- `npm run typecheck`
  - Passed.
- `git diff --check`
  - Passed with no output.

### Self-Review

- Snapshot writes can no longer associate a user with another user's character: both status-only and full snapshot writes are rejected by the composite ownership foreign key.
- `0001` no longer changes after its original migration identity; the asset schema is isolated in the new `0002` migration.
- The Postgres migration references `app_users`, not `users`, and the local tests migrate and seed characters before asserting ownership behavior.
- Live Postgres execution remains environment-gated, but SQL shape and behavior-specific Postgres query coverage are local and fast.

## Ownership-Transfer Fix

### Changes

- Made SQLite character authorization delete any existing asset snapshot for a character owned by a different app user before updating `characters.user_id`, within the same transaction. The cleanup is skipped when the optional asset snapshot table has not been migrated.
- Made Postgres character authorization delete the old owner's asset snapshot before its character upsert, within one transaction.
- Added a SQLite regression test using the real character and asset stores/migrations to verify reauthorization succeeds after a snapshot exists and leaves no private cached data for either account.
- Added fake-client Postgres coverage that verifies the snapshot deletion occurs before the character upsert.

### Verification

- `node --import tsx --test src/assets/store.test.ts src/characters/store.test.ts src/db/migrations.test.ts`
  - Passed: 16 tests, 0 failures.
- `npm test`
  - Passed: 213 tests, 0 failures; 8 Postgres integration tests skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured.
- `npm run typecheck`
  - Passed.
- `git diff --check`
  - Passed with no output.

### Self-Review

- Ownership transfer removes private snapshots instead of cascading them to the new app account; the strict composite ownership foreign keys remain unchanged.
- Both cleanup and ownership update are transactional, so a failed upsert rolls back the snapshot deletion.
- SQLite coverage exercises the actual migration and stores; Postgres query-order coverage uses the existing fake client.

### Concerns

- Live Postgres integration coverage remains unavailable without `DATABASE_URL` and `TEST_DATABASE_URL`.

Review fix: updated live Postgres migration expectations for 0002_asset_snapshots.
Commands run:
- node --import tsx --test src/assets/store.test.ts src/characters/store.test.ts src/db/migrations.test.ts src/db/postgres.integration.test.ts: 16 passed, 1 skipped (DATABASE_URL and TEST_DATABASE_URL are required).
- npm run typecheck: passed.
- git diff --check: passed.
- npm test: 213 passed, 8 skipped.
Concerns: live Postgres integration remains skipped locally without database env vars.
