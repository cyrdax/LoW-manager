# Discord Fit Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build and ship a Discord bot-backed fit importer that scans one channel/thread, reviews discovered EFT/Pyfa fits, and imports selected rows into the saved Fits library.

**Architecture:** Add a focused Discord import backend module, register authenticated routes under `/api/discord/import/*`, and extend the existing Fits import modal with a Discord tab. The backend reuses the existing EFT block parser, fit draft builder, Pyfa screenshot extractor, and fit store so imports behave like the current fit workflow.

**Tech Stack:** TypeScript, Fastify, React, Discord REST API v10, existing OpenAI-backed Pyfa screenshot extraction, existing SQLite/Postgres fit stores.

## Global Constraints

- Use `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`.
- Any logged-in app user can scan Discord imports.
- Import saved fits only, not doctrines.
- Scan exactly one channel/thread at a time.
- Default scan depth is 100 messages.
- OCR at most 10 Discord image attachments per scan.
- Do not process text/EFT file attachments.
- Use the current Fits public/private visibility scope.
- Match duplicates by same resolved hull and normalized fit name.
- Keep Discord image bytes transient and do not persist them.

---

### Task 1: Discord Import Core

**Files:**
- Create: `src/discord/import.ts`
- Test: `src/discord/import.test.ts`

**Interfaces:**
- Produces `DiscordImportChannel`, `DiscordImportScanResult`, `DiscordImportApplyInput`.
- Produces `createDiscordImportService(deps)` with `listChannels()`, `scan(input)`, and `apply(input)`.

- [x] **Step 1: Write failing tests**

Add tests for channel mapping/sorting, EFT extraction from message text/code blocks, 10-image cap with skipped count, duplicate planning, and apply create/update/skip.

- [x] **Step 2: Run tests to verify red**

Run: `node --import tsx --test src/discord/import.test.ts`
Expected: FAIL because `src/discord/import.ts` does not exist.

- [x] **Step 3: Implement core service**

Implement:

```ts
export const DISCORD_MESSAGE_LIMIT = 100;
export const DISCORD_IMAGE_SCAN_LIMIT = 10;

export interface DiscordImportChannel {
  id: string;
  label: string;
  type: 'channel' | 'thread';
  parentId: string | null;
  parentName: string | null;
}
```

Use injected dependencies for Discord API calls, fit store access, fit draft building, and Pyfa extraction so tests do not need network.

- [x] **Step 4: Run tests to verify green**

Run: `node --import tsx --test src/discord/import.test.ts`
Expected: PASS.

---

### Task 2: Discord Import Routes

**Files:**
- Create: `src/routes/discord-import.ts`
- Test: `src/routes/discord-import.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes `createDiscordImportService`.
- Produces:
  - `GET /api/discord/import/channels`
  - `POST /api/discord/import/scan`
  - `POST /api/discord/import/apply`

- [x] **Step 1: Write failing route tests**

Cover auth required, channels response, scan response, apply response, and missing config errors.

- [x] **Step 2: Run route tests to verify red**

Run: `node --import tsx --test src/routes/discord-import.test.ts`
Expected: FAIL because routes do not exist.

- [x] **Step 3: Implement routes and server registration**

Routes call `requireUser`, parse visibility as `public | private`, and delegate to the service. `server.ts` registers the routes with the existing Postgres fit store and default Pyfa extractor.

- [x] **Step 4: Run route tests to verify green**

Run: `node --import tsx --test src/routes/discord-import.test.ts`
Expected: PASS.

---

### Task 3: Frontend API And Import Modal

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/components/FitsView.tsx`
- Modify: `web/src/styles.css`
- Test: `src/fits/import-modal-view.test.ts`

**Interfaces:**
- Consumes Discord import routes.
- Produces `fetchDiscordImportChannels`, `scanDiscordImport`, and `applyDiscordImport` API helpers.

- [x] **Step 1: Write failing frontend/static tests**

Assert the import modal exposes `Paste EFT`, `pyfa Screenshot`, and `Discord`; Discord tab has channel picker, scan button, scan summary, grouped results, action selectors, and import selected button.

- [x] **Step 2: Run tests to verify red**

Run: `node --import tsx --test src/fits/import-modal-view.test.ts`
Expected: FAIL because Discord UI/API helpers do not exist.

- [x] **Step 3: Implement UI**

Extend the import mode state to `eft | pyfa-image | discord`. Add state for channel list, selected channel, scan result, selected actions, busy/error states, and import completion status.

- [x] **Step 4: Run tests to verify green**

Run: `node --import tsx --test src/fits/import-modal-view.test.ts`
Expected: PASS.

---

### Task 4: Verification And Shipping

**Files:**
- Modify: `.env.example`
- Use existing deployment config.

- [x] **Step 1: Add env docs**

Add `DISCORD_BOT_TOKEN=` and `DISCORD_GUILD_ID=` to `.env.example`.

- [x] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all pass.

- [x] **Step 3: Commit, push, deploy**

Run:

```bash
git add .
git commit -m "feat: import fits from discord"
git push origin main
railway up --detach
```

- [x] **Step 4: Verify production**

Run:

```bash
curl -sS https://outfit420-2.com/api/health
```

Expected: `{"ok":true}`.
