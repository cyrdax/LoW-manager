# Task 6 Empty Roster Fix Report

Status: Complete

Changed files:
- `web/src/assets-filter.ts`: preserve zero-location pilots only for the unfiltered `query === '' && category === 'all'` view; hide them when search or category filtering is active.
- `src/assets/assets-view.test.ts`: add regression coverage for the unfiltered placeholder and filtered removal behavior.

Commits:
- `8787b7047f37313587516c07f05b02b27eee8cd0` (`fix: preserve empty asset roster pilots`)

Tests:
- PASS `node --import tsx --test src/assets/assets-view.test.ts` (8 passed, 0 failed)
- PASS `npm test` (245 passed, 0 failed, 8 skipped because `DATABASE_URL` and `TEST_DATABASE_URL` are not configured)
- PASS `npm run build`

Concerns:
- No known concerns. PostgreSQL-backed tests were skipped by the existing environment guard.
