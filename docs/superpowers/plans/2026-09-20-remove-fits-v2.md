# Remove Fits V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Fits V2 while preserving legacy Fits/Doctrines behavior and compatibility for old V2 links.

**Architecture:** Collapse every former V2 URL into the existing legacy Fits route model, then remove the isolated V2 UI and editor-document backend contract. Preserve the deployed database column as inert legacy schema so removal never destroys stored data.

**Tech Stack:** TypeScript, React, Node.js test runner, Express, PostgreSQL migrations, Vite

**Spec:** `docs/superpowers/specs/2026-09-20-remove-fits-v2-design.md`

## Global Constraints

- Preserve the working legacy Fits and Doctrines flows.
- Preserve fit IDs when resolving old detail URLs.
- Do not drop or mutate the existing `editor_json` database column.
- Use failing behavioral tests before production changes.

---

### Task 1: Collapse V2 URLs into legacy Fits

**Files:**
- Modify: `src/app-routing.test.ts`
- Modify: `src/app-routing-view.test.ts`
- Modify: `src/auth/frontend-auth-view.test.ts`
- Modify: `web/src/app-routing.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: existing `parseAppRoute(location)` and `pathForRoute(route)` routing contracts
- Produces: one `{ view: 'fits'; fitId?: number }` route shape for both legacy and former V2 URLs

- [x] **Step 1: Write the failing route tests**

Add literal expectations that `/fits-v2` and `/fits/v2` parse as `{ view: 'fits' }`, while `/fit-v2/42` and `/fit/v2/42` parse as `{ view: 'fits', fitId: 42 }`.

- [x] **Step 2: Run the route tests and verify RED**

Run: `node --import tsx --test src/app-routing.test.ts src/app-routing-view.test.ts src/auth/frontend-auth-view.test.ts`

Expected: FAIL because former V2 URLs still produce `view: 'fitsV2'` and the app still exposes the V2 route.

- [x] **Step 3: Implement the minimal routing change**

Remove `fitsV2` from `View` and `AppRoute`, map former V2 paths to `fits`, remove V2 path generation, and make `App.tsx` use only the legacy Fits view for those routes.

- [x] **Step 4: Run the route tests and verify GREEN**

Run: `node --import tsx --test src/app-routing.test.ts src/app-routing-view.test.ts src/auth/frontend-auth-view.test.ts`

Expected: PASS.

### Task 2: Remove the V2 navigation and React surface

**Files:**
- Modify: `web/src/components/ControlPanel.tsx`
- Delete: `web/src/components/FitsV2View.tsx`
- Delete: `src/fits/fits-v2-view.test.ts`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: the existing `fits` navigation callback
- Produces: a single Fits navigation target with no V2 editor render path

- [x] **Step 1: Use the failing Task 1 app-shell assertions as the RED gate**

The changed routing/auth tests must fail while `App.tsx` and the control panel still reference Fits V2.

- [x] **Step 2: Remove the V2 UI**

Delete the V2 view and source-presence tests, remove its import/render/navigation button, and remove selectors used only by that view.

- [x] **Step 3: Run focused UI-adjacent tests**

Run: `node --import tsx --test src/app-routing.test.ts src/app-routing-view.test.ts src/auth/frontend-auth-view.test.ts src/fits/fits-view.test.ts`

Expected: PASS.

### Task 3: Retire the editor-document API contract

**Files:**
- Modify: `src/routes/fits.test.ts`
- Modify: `src/routes/fits.ts`
- Modify: `src/fits/store.test.ts`
- Modify: `src/fits/store.ts`
- Modify: `src/fits/types.ts`
- Modify: `web/src/api.ts`
- Delete: `src/fits/editor.ts`
- Delete: `src/fits/editor.test.ts`

**Interfaces:**
- Consumes: raw EFT text as the canonical saved-fit representation
- Produces: saved-fit responses without an `editorJson` field

- [x] **Step 1: Write a failing route test**

Post a saved fit payload containing an `editorJson` member and assert the returned saved fit has no `editorJson` property while its raw EFT is preserved.

- [x] **Step 2: Run the focused route/store tests and verify RED**

Run: `node --import tsx --test src/routes/fits.test.ts src/fits/store.test.ts`

Expected: FAIL because the API currently parses, stores, and returns `editorJson`.

- [x] **Step 3: Remove editor-document plumbing**

Remove the V2 types, parser/serializer calls, route input member, store model member, frontend API member, and editor implementation. Keep the database migration unchanged.

- [x] **Step 4: Run the focused route/store tests and verify GREEN**

Run: `node --import tsx --test src/routes/fits.test.ts src/fits/store.test.ts`

Expected: PASS.

### Task 4: Remove remaining V2 metadata and obsolete artifacts

**Files:**
- Modify: doctrine files and tests that expose `hasEditorJson`
- Delete: `docs/superpowers/specs/2026-08-22-fits-v2-dogma-editor-design.md`
- Delete: `docs/superpowers/plans/2026-08-22-fits-v2-dogma-editor.md`
- Preserve: `src/db/migrations/0005_saved_fit_editor_json.sql`

**Interfaces:**
- Consumes: legacy saved-fit EFT data
- Produces: doctrine summaries independent of Fits V2 editor metadata

- [x] **Step 1: Remove V2-only assertions and metadata**

Delete the `hasEditorJson` summary field and its tests, then delete obsolete V2 planning documents.

- [x] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS with zero failures.

- [x] **Step 3: Verify types and production build**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [x] **Step 4: Audit residual references**

Run: `rg -n -i 'fitsV2|Fits V2|fits-v2|fit-v2|editorJson|hasEditorJson' src web docs --glob '!docs/superpowers/specs/2026-09-20-remove-fits-v2-design.md' --glob '!docs/superpowers/plans/2026-09-20-remove-fits-v2.md'`

Expected: only intentional compatibility route aliases or inert migration references remain; no live V2 product implementation remains.

- [ ] **Step 5: Commit the verified removal**

Run: `git add -A && git commit -m "refactor: remove fits v2"`
