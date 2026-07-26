# Doctrine Google Doc Fit Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a doctrine refresh action that reads EFT blocks from the doctrine's existing Google Doc URL, updates matching doctrine fits, creates missing fits, and never removes existing doctrine members.

**Architecture:** Add a focused domain module for Google Doc URL export, EFT block extraction, and doctrine fit synchronization. Expose it through `POST /api/doctrines/:id/refresh-fits`, then add a doctrine UI button and result summary. Reuse existing fit store, doctrine store, permission checks, and fit validation.

**Tech Stack:** TypeScript, Fastify, React, existing fit/doctrine stores, Node test runner.

## Global Constraints

- Use the doctrine's existing `googleDocUrl`; do not add a second source URL.
- Google Doc must be public/readable by link for V1.
- Match existing doctrine fits by normalized saved fit name.
- Create missing fits and add them to the doctrine.
- Never remove doctrine fits that are absent from the Google Doc.
- Only doctrine owner or admin can refresh.
- Partial success is allowed and must return updated, created, skipped, ambiguous, and failed details.

---

### Task 1: Parser And Sync Domain

**Files:**
- Create: `src/fits/google-doc-sync.ts`
- Test: `src/fits/google-doc-sync.test.ts`

**Interfaces:**
- Produces: `extractEftBlocksFromText(text: string): ParsedEftBlock[]`
- Produces: `googleDocTextExportUrl(url: string): string | null`
- Produces: `syncDoctrineFitsFromText(input: DoctrineFitSyncInput): Promise<DoctrineFitSyncResult>`

- [ ] **Step 1: Write failing parser and sync tests**

Create tests proving mixed prose yields multiple EFT blocks, invalid docs URLs are rejected, one matching doctrine fit updates, missing blocks create fits and doctrine membership, ambiguous names skip, and absent doctrine fits are retained.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --test-name-pattern "google doc fit sync"`
Expected: FAIL because `src/fits/google-doc-sync.ts` does not exist.

- [ ] **Step 3: Implement domain module**

Implement URL conversion for `https://docs.google.com/document/d/<id>/...` to `/export?format=txt`, EFT header scanning, normalized fit name matching, fit update/create calls, doctrine add-fit calls, and partial failure collection.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- --test-name-pattern "google doc fit sync"`
Expected: PASS.

### Task 2: Doctrine Route And API

**Files:**
- Modify: `src/routes/doctrines.ts`
- Modify: `src/routes/doctrines.test.ts`
- Modify: `web/src/api.ts`

**Interfaces:**
- Consumes: `syncDoctrineFitsFromText`
- Produces: `POST /api/doctrines/:id/refresh-fits`
- Produces frontend helper `refreshDoctrineFits(id: number): Promise<DoctrineFitRefreshResult | { error: string }>`

- [ ] **Step 1: Write failing route/API tests**

Add tests proving unauthorized users cannot refresh, missing Google Doc URL returns a clear error, route fetches doc text through an injected fetcher, and response includes updated/created results plus refreshed doctrine detail.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --test-name-pattern "doctrine.*refresh|frontend exposes doctrine"`
Expected: FAIL because the route and helper do not exist.

- [ ] **Step 3: Implement route and API helper**

Add route dependency injection for `fetchGoogleDocText`, fetch text from the export URL with size/error checks, call sync service, and return result. Add TypeScript response types and frontend helper.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- --test-name-pattern "doctrine.*refresh|frontend exposes doctrine"`
Expected: PASS.

### Task 3: Doctrine UI

**Files:**
- Modify: `web/src/components/DoctrinesView.tsx`
- Modify: `src/fits/doctrine-view.test.ts`

**Interfaces:**
- Consumes: `refreshDoctrineFits(id)`
- Produces: owner/admin `Refresh Fits` action and result summary in doctrine view.

- [ ] **Step 1: Write failing UI wiring test**

Add static UI test proving the doctrine view imports `refreshDoctrineFits`, renders `Refresh Fits`, checks `googleDocUrl`, and displays created/updated/skipped result information.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --test-name-pattern "doctrine view"`
Expected: FAIL because UI lacks the refresh wiring.

- [ ] **Step 3: Implement UI**

Add refresh state, call helper, update doctrine detail/list after success, and show a compact summary with problem details.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test -- --test-name-pattern "doctrine view"`
Expected: PASS.

### Task 4: Final Verification And Ship

**Files:**
- All files changed by Tasks 1-3

- [ ] **Step 1: Run focused tests**

Run: `npm test -- --test-name-pattern "google doc fit sync|doctrine.*refresh|frontend exposes doctrine|doctrine view"`
Expected: PASS.

- [ ] **Step 2: Run build and diff check**

Run: `npm run build`
Run: `git diff --check`
Expected: both exit 0.

- [ ] **Step 3: Commit, push, deploy, verify**

Commit with `feat: sync doctrine fits from google docs`, push `main`, deploy with Railway, and verify production `/api/health`.
