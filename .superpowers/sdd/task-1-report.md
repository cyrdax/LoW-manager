Status: DONE

Commits created:
- `8dfbd75 feat: add asset categorization and tree aggregates`

Tests run and exact result:
- `node --import tsx --test src/assets/categories.test.ts`: failed as expected before implementation because `src/assets/categories.ts` did not exist.
- `node --import tsx --test src/assets/categories.test.ts src/assets/tree.test.ts src/fits/metadata.test.ts`: 8 passed, 0 failed.
- `npm run typecheck`: passed, exit code 0.
- `npm test`: 194 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` were not configured.
- `git diff --cached --check`: passed.

Self-review notes:
- Added the exact asset domain types, category labels and mappings, nested tree construction, rollup summaries, and metadata lookup by type ID required by the brief.
- Preserved existing metadata name and ship indexes while populating the new item ID index for both mastery and Fuzzwork items.
- Confirmed the staged change set was limited to the seven assigned source/test files.

Any concerns:
- The full test suite retains its existing eight database-dependent skips because no database test URLs were available.

## Fix Report (2026-07-17)

Fixed reviewer findings in the Task 1 asset domain helpers:
- Replaced insertion-order aggregate recalculation with guarded post-order traversal, and detached cyclic parent links before tree construction.
- Added and exported `aggregateAssetSnapshot(input)` while preserving `buildAssetTree(input)` as a compatibility wrapper.
- Moved mining and module classification from broad item-name/substrings to explicit mining group IDs and normalized module group names. Venture and Prospect now classify as `mining-ships`; Sensor Booster II remains `modules`.

Tests added:
- Parent-first, three-level containment regression for item count, stack count, and value rollups.
- Public `aggregateAssetSnapshot(input)` coverage.
- Venture, Prospect, and Sensor Booster II category regressions.

Commands run and results:
- `node --import tsx --test src/assets/categories.test.ts`: 2 passed and 2 failed before the fix, reproducing the mining-frigate and sensor-booster bugs.
- `node --import tsx --test src/assets/tree.test.ts`: failed before the fix because `aggregateAssetSnapshot` was not exported.
- `node --import tsx --test src/assets/categories.test.ts src/assets/tree.test.ts`: 8 passed, 0 failed after the fix.
- `npm run typecheck`: passed, exit code 0.
- `git diff --check`: passed, exit code 0.

## Second Fix Report (2026-07-17)

Fixed the follow-up review findings:
- Replaced the fabricated mining-frigate regression metadata with actual Venture (`typeId` 32880, Frigate group 25) and Prospect (`typeId` 33697, Expedition Frigate group 1283) metadata. Venture is now recognized by its mining hull type ID; Prospect is recognized by its expedition-frigate group ID and name.
- When a parent edge is rejected because it would form a cycle, the node now clears `parentItemId` before becoming a location root. Added a two-node cycle regression test covering the detached root and accepted child link.

Commands run and results:
- `node --import tsx --test src/assets/categories.test.ts src/assets/tree.test.ts`: 7 passed and 2 failed before the fix, reproducing the real Venture classification and stale rejected-parent bugs; 9 passed, 0 failed after the fix.
- `npm test`: 199 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` were not configured.
- `npm run typecheck`: passed, exit code 0.
- `git diff --check`: passed, exit code 0.
