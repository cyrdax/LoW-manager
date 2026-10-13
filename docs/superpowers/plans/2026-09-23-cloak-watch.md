# Outfit420 Cloak Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable macOS and Windows tray companion that watches EVE game logs and emits one local sound plus one OS notification for each actual decloak message.

**Architecture:** Add a standalone Electron package under `desktop/cloak-watch/` so Electron never enters the Railway dependency graph. Pure TypeScript modules handle parsing, byte-safe incremental tailing, settings, and monitoring; a thin Electron main process supplies tray, notification, audio, dialog, and login-item adapters.

**Tech Stack:** Node.js 24 LTS, Electron 44.4.5, Electron Builder 26.15.3, Chokidar 5.0.0, TypeScript 7.0.2, tsx 4.23.15, Node test runner, vanilla HTML/CSS/JavaScript renderer

**Spec:** `docs/superpowers/specs/2026-09-23-cloak-watch-design.md`

## Global Constraints

- Support current macOS and Windows with native builds produced on their respective GitHub Actions runners.
- Keep `desktop/cloak-watch/` independent: no root npm workspace and no Electron dependency in the root `package.json` or Railway installation.
- Read only the user-selected plain-text `Gamelogs` directory; never write inside it.
- Make no network requests and include no ESI, SSO, telemetry, update, upload, or remote-content code.
- Include no client hooks, memory access, packet inspection, cache scraping, overlays, focus control, or keyboard/mouse automation.
- Never claim continuous cloak state; only report a newly parsed decloak message.
- Recognize English log messages in the first release and preserve table-driven classification rules.
- Start existing files at EOF so historical decloaks never alert.
- Use test-first development for every behavioral production module.
- Pin Electron `44.4.5`, Electron Builder `26.15.3`, Chokidar `5.0.0`, TypeScript `7.0.2`, tsx `4.23.15`, and `@types/node` `24.13.6`.

---

### Task 1: Scaffold an isolated desktop package

**Files:**
- Create: `src/cloak-watch-package.test.ts`
- Create: `desktop/cloak-watch/package.json`
- Create: `desktop/cloak-watch/package-lock.json`
- Create: `desktop/cloak-watch/tsconfig.json`
- Create: `desktop/cloak-watch/tsconfig.build.json`
- Create: `desktop/cloak-watch/scripts/clean.mjs`
- Create: `desktop/cloak-watch/scripts/copy-static.mjs`
- Create: `desktop/cloak-watch/build/icon.png`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the repository's existing Node test runner and `web/public/outfit-icon-512.png`
- Produces: an independent desktop package with `test`, `typecheck`, `build`, `dev`, `package:mac`, and `package:win` scripts

- [ ] **Step 1: Write the failing package-isolation test**

Create `src/cloak-watch-package.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(path: URL): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

test('cloak watch remains isolated from the Railway package', async () => {
  const root = await readJson(new URL('../package.json', import.meta.url));
  const desktop = await readJson(
    new URL('../desktop/cloak-watch/package.json', import.meta.url),
  );

  assert.equal(root.workspaces, undefined);
  assert.equal(root.dependencies?.electron, undefined);
  assert.equal(root.devDependencies?.electron, undefined);
  assert.equal(desktop.main, 'dist/main/index.js');
  assert.equal(desktop.dependencies.chokidar, '5.0.0');
  assert.equal(desktop.devDependencies.electron, '44.4.5');
  assert.equal(desktop.devDependencies['electron-builder'], '26.15.3');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --import tsx --test src/cloak-watch-package.test.ts
```

Expected: FAIL with `ENOENT` for `desktop/cloak-watch/package.json`.

- [ ] **Step 3: Add the standalone package configuration**

Create `desktop/cloak-watch/package.json` with this contract:

```json
{
  "name": "outfit420-cloak-watch",
  "version": "0.1.0",
  "private": true,
  "description": "Local read-only EVE decloak log notifier",
  "type": "module",
  "main": "dist/main/index.js",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "test:focused": "node --import tsx --test",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "clean": "node scripts/clean.mjs",
    "build": "npm run clean && tsc -p tsconfig.build.json && node scripts/copy-static.mjs",
    "dev": "npm run build && electron .",
    "package:mac": "npm run build && electron-builder --mac dmg zip --publish never",
    "package:win": "npm run build && electron-builder --win nsis portable --publish never",
    "publish:mac": "npm run build && electron-builder --mac dmg zip --publish always",
    "publish:win": "npm run build && electron-builder --win nsis portable --publish always"
  },
  "dependencies": {
    "chokidar": "5.0.0"
  },
  "devDependencies": {
    "@types/node": "24.13.6",
    "electron": "44.4.5",
    "electron-builder": "26.15.3",
    "tsx": "4.23.15",
    "typescript": "7.0.2"
  },
  "build": {
    "appId": "com.outfit420.cloakwatch",
    "productName": "Outfit420 Cloak Watch",
    "asar": true,
    "directories": {
      "buildResources": "build",
      "output": "release"
    },
    "files": ["dist/**/*", "package.json"],
    "mac": {
      "category": "public.app-category.utilities",
      "identity": null,
      "target": ["dmg", "zip"]
    },
    "win": {
      "target": ["nsis", "portable"]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "publish": {
      "provider": "github",
      "releaseType": "draft"
    }
  }
}
```

Set both TypeScript configurations to `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `rootDir: src`, and `outDir: dist`; `tsconfig.build.json` must exclude `src/**/*.test.ts`. Make `scripts/clean.mjs` remove only the package's `dist/` directory. Make `scripts/copy-static.mjs` create `dist/ui/` and copy `src/ui/index.html`, `styles.css`, `renderer.js`, and `preload.cjs` without deleting the TypeScript output that was just emitted.

Copy the existing self-contained PNG without editing it:

```bash
mkdir -p desktop/cloak-watch/build
cp web/public/outfit-icon-512.png desktop/cloak-watch/build/icon.png
```

Add these package-local outputs to `.gitignore`:

```gitignore
desktop/cloak-watch/node_modules/
desktop/cloak-watch/dist/
desktop/cloak-watch/release/
```

- [ ] **Step 4: Install the pinned desktop dependencies**

Run:

```bash
npm install --prefix desktop/cloak-watch
```

Expected: `desktop/cloak-watch/package-lock.json` records the exact direct dependency versions above.

- [ ] **Step 5: Run the package-isolation test and verify GREEN**

Run:

```bash
node --import tsx --test src/cloak-watch-package.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the isolated scaffold**

Run:

```bash
git add .gitignore src/cloak-watch-package.test.ts desktop/cloak-watch
git commit -m "build: scaffold cloak watch desktop app"
```

---

### Task 2: Parse and classify EVE decloak messages

**Files:**
- Create: `desktop/cloak-watch/src/core/types.ts`
- Create: `desktop/cloak-watch/src/core/parser.test.ts`
- Create: `desktop/cloak-watch/src/core/parser.ts`

**Interfaces:**
- Produces: `ParsedLogEntry`, `DecloakEvent`, `parseListener(line)`, `parseLogEntry(line)`, `sanitizeEveMessage(message)`, and `toDecloakEvent(entry, context)`
- Consumes: raw decoded EVE log lines plus `{ characterName, sourceFile, byteOffset }`

- [ ] **Step 1: Write failing parser tests**

Create table-driven tests containing these exact representative lines:

```ts
const positives = [
  'Your cloak deactivates due to proximity to a nearby Scourge Light Missile.',
  'Your cloak deactivates due to a pulse from a Mobile Observatory.',
  'Your cloaking device has been forcibly deactivated.',
  'You have been decloaked by a nearby object.',
];

const negatives = [
  'Improved Cloaking Device II fails to activate as it is still recovering from its last period of operation and will be for the next 26 seconds.',
  'Your cloaking systems are unable to activate due to your ship being within 2000 meters of the nearby Refinery.',
  'You cannot cloak your ship as you are being targeted by someone.',
  'Interference from the cloaking you are doing is preventing your systems from functioning at this time.',
  'Covert Ops Cloaking Device II is active.',
];
```

Assert that:

```ts
assert.equal(parseListener('  Listener: Cyrdax Prime'), 'Cyrdax Prime');
assert.deepEqual(
  parseLogEntry('[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity to a nearby ship.'),
  {
    occurredAt: '2026-09-23T03:04:05.000Z',
    category: 'notify',
    message: 'Your cloak deactivates due to proximity to a nearby ship.',
  },
);
assert.equal(
  sanitizeEveMessage('<color=0xffffffff>Your cloak deactivates</color> due to proximity.'),
  'Your cloak deactivates due to proximity.',
);
```

For every positive, assert `toDecloakEvent(...)` returns an event with the character, sanitized message, source file, and byte offset. For every negative and malformed header/entry, assert it returns `null`.

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/parser.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement the parser and explicit types**

Define these public contracts in `types.ts`:

```ts
export interface ParsedLogEntry {
  occurredAt: string;
  category: string;
  message: string;
}

export interface DecloakEvent {
  characterName: string;
  occurredAt: string;
  message: string;
  sourceFile: string;
  byteOffset: number;
}

export interface DecloakContext {
  characterName: string | null;
  sourceFile: string;
  byteOffset: number;
}
```

Implement classification as ordered, data-only regular-expression tables:

```ts
const EXCLUSIONS = [
  /fails? to activate/i,
  /unable to activate/i,
  /cannot cloak/i,
  /still recovering/i,
  /preventing your systems from functioning/i,
];

const DECLOAK_PATTERNS = [
  /\bde[ -]?cloak(?:ed|ing)?\b/i,
  /\bcloak(?:ing|ing device)?\b.*\b(?:deactivat|forcibly disrupt|forcibly disable)/i,
  /\b(?:deactivat|forcibly disrupt|forcibly disable).*\bcloak/i,
];
```

Parse only the standard `[ YYYY.MM.DD HH:mm:ss ] (category) message` structure. Convert EVE timestamps to UTC ISO strings, strip EVE-like tags, decode common entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`), and normalize whitespace. Unknown characters must use `Unknown EVE client`.

- [ ] **Step 4: Run parser tests and verify GREEN**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the parser**

Run:

```bash
git add desktop/cloak-watch/src/core
git commit -m "feat: classify EVE decloak log messages"
```

---

### Task 3: Decode and tail logs without replaying history

**Files:**
- Create: `desktop/cloak-watch/src/core/line-decoder.test.ts`
- Create: `desktop/cloak-watch/src/core/line-decoder.ts`
- Create: `desktop/cloak-watch/src/core/tracked-log.test.ts`
- Create: `desktop/cloak-watch/src/core/tracked-log.ts`

**Interfaces:**
- Produces: `detectEncoding(prefix)`, `StreamingLineDecoder.push(bytes, offset)`, `TrackedLog.open(path, mode)`, and `TrackedLog.readAppended()`
- Consumes: file bytes and `mode: 'existing' | 'new'`

- [ ] **Step 1: Write failing streaming-decoder tests**

Use both encodings and split every sample at each possible byte boundary:

```ts
const sample = [
  '  Listener: Cyrdax Prime',
  '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.',
  '',
].join('\r\n');

for (const encoding of ['utf8', 'utf16le'] as const) {
  const encoded = Buffer.from(sample, encoding);
  for (let split = 1; split < encoded.length; split += 1) {
    const decoder = new StreamingLineDecoder(encoding);
    const lines = [
      ...decoder.push(encoded.subarray(0, split), 0),
      ...decoder.push(encoded.subarray(split), split),
    ];
    assert.deepEqual(lines.map((line) => line.text), [
      '  Listener: Cyrdax Prime',
      '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.',
    ]);
  }
}
```

Also assert correct BOM detection, CRLF removal, and the byte offset of each emitted line.

- [ ] **Step 2: Run decoder tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/line-decoder.test.ts
```

Expected: FAIL because the decoder module does not exist.

- [ ] **Step 3: Implement byte-safe line decoding**

Expose:

```ts
export type LogEncoding = 'utf8' | 'utf16le';

export interface DecodedLine {
  text: string;
  byteOffset: number;
}

export function detectEncoding(prefix: Uint8Array): LogEncoding;

export class StreamingLineDecoder {
  constructor(encoding: LogEncoding);
  push(bytes: Uint8Array, startOffset: number): DecodedLine[];
  reset(nextOffset?: number): void;
}
```

Keep undecoded raw bytes, search for `0A` in UTF-8 and aligned `0A 00` in UTF-16LE, remove a preceding CR sequence, decode only complete lines, and retain the absolute start offset for every line. Strip the BOM only from the first decoded line.

- [ ] **Step 4: Run decoder tests and verify GREEN**

Run the Step 2 command and expect PASS.

- [ ] **Step 5: Write failing tracked-file tests**

Create temporary UTF-8 and UTF-16LE files and assert:

```ts
const existing = await TrackedLog.open(file, 'existing');
assert.deepEqual(await existing.readAppended(), {
  lines: [],
  truncated: false,
});

await appendFile(file, decloakLine);
assert.equal((await existing.readAppended()).lines.length, 1);

const fresh = await TrackedLog.open(newFile, 'new');
const initial = await fresh.readAppended();
assert.equal(initial.lines.some((line) => line.text.includes('Listener:')), true);
```

Add cases for a partial final line, repeated reads, file truncation, deletion, and unsupported UTF-16BE BOM. Existing mode must inspect enough header bytes to obtain `Listener:` while still placing the event cursor at EOF.

- [ ] **Step 6: Run tracked-file tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/tracked-log.test.ts
```

Expected: FAIL because `TrackedLog` does not exist.

- [ ] **Step 7: Implement incremental file tracking**

Expose:

```ts
export interface TrackedRead {
  lines: DecodedLine[];
  truncated: boolean;
}

export class TrackedLog {
  readonly filePath: string;
  readonly encoding: LogEncoding;
  characterName: string | null;

  static open(filePath: string, mode: 'existing' | 'new'): Promise<TrackedLog>;
  readAppended(): Promise<TrackedRead>;
}
```

Use `FileHandle.read` with explicit positions. Existing mode reads the initial header for metadata, sets its live cursor to current `stat.size`, and empties the decoder before returning. New mode starts at byte zero. When size decreases, reset the cursor and decoder, mark `truncated: true`, and parse the replacement as content written during the active monitoring session. A missing file must return an empty read with a typed `LogFileGoneError` so the monitor can retire it without crashing.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/line-decoder.test.ts src/core/tracked-log.test.ts
git add desktop/cloak-watch/src/core
git commit -m "feat: tail EVE logs without replaying history"
```

Expected: all focused tests PASS before the commit.

---

### Task 4: Persist preferences and discover the log directory

**Files:**
- Create: `desktop/cloak-watch/src/core/settings.test.ts`
- Create: `desktop/cloak-watch/src/core/settings.ts`
- Create: `desktop/cloak-watch/src/core/log-directory.test.ts`
- Create: `desktop/cloak-watch/src/core/log-directory.ts`

**Interfaces:**
- Produces: `AppSettings`, `DEFAULT_SETTINGS`, `SettingsStore`, `defaultLogDirectory(documentsPath)`, and `validateLogDirectory(path)`
- Consumes: Electron-provided documents and user-data directories

- [ ] **Step 1: Write failing settings tests**

Use a temporary user-data directory and assert these exact defaults:

```ts
assert.deepEqual(await store.load(), {
  version: 1,
  logDirectory: null,
  soundEnabled: true,
  notificationsEnabled: true,
  startAtLogin: true,
});
```

Save a modified value, instantiate a new store, and prove it survives restart. Write malformed JSON, then assert `load()` moves it to `settings.json.corrupt`, restores defaults, and returns a non-null warning. Spy on rename/write order through an injected filesystem adapter so the test proves write-then-rename atomicity.

- [ ] **Step 2: Run settings tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/settings.test.ts
```

Expected: FAIL because the settings module does not exist.

- [ ] **Step 3: Implement versioned atomic settings**

Expose:

```ts
export interface AppSettings {
  version: 1;
  logDirectory: string | null;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  startAtLogin: boolean;
}

export interface SettingsLoadResult {
  settings: AppSettings;
  warning: string | null;
}

export class SettingsStore {
  constructor(userDataDirectory: string, fileSystem?: SettingsFileSystem);
  load(): Promise<SettingsLoadResult>;
  save(settings: AppSettings): Promise<void>;
}
```

Validate every field manually, reject unknown `version` values, write `settings.json.tmp`, and rename it to `settings.json` only after the write succeeds.

- [ ] **Step 4: Run settings tests and verify GREEN**

Run the Step 2 command and expect PASS.

- [ ] **Step 5: Write failing directory tests**

Assert:

```ts
assert.equal(
  defaultLogDirectory('/Users/test/Documents'),
  join('/Users/test/Documents', 'EVE', 'logs', 'Gamelogs'),
);
assert.deepEqual(await validateLogDirectory(readableDirectory), { ok: true });
assert.deepEqual(await validateLogDirectory(missingDirectory), {
  ok: false,
  reason: 'not-found',
});
assert.deepEqual(await validateLogDirectory(aFile), {
  ok: false,
  reason: 'not-directory',
});
```

Use an injected `access/stat` adapter for a deterministic `not-readable` case on both platforms.

- [ ] **Step 6: Run directory tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/log-directory.test.ts
```

Expected: FAIL because the directory module does not exist.

- [ ] **Step 7: Implement discovery and validation**

Return only these validation results:

```ts
export type DirectoryValidation =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-directory' | 'not-readable' };
```

Never create the directory and never write a probe file inside it.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/settings.test.ts src/core/log-directory.test.ts
git add desktop/cloak-watch/src/core
git commit -m "feat: persist cloak watch preferences"
```

Expected: all focused tests PASS.

---

### Task 5: Monitor multiple live game logs

**Files:**
- Create: `desktop/cloak-watch/src/core/log-monitor.test.ts`
- Create: `desktop/cloak-watch/src/core/log-monitor.ts`

**Interfaces:**
- Consumes: `TrackedLog`, parser functions, Chokidar add/change/unlink events, and one selected directory
- Produces: `LogMonitor.start()`, `LogMonitor.reconcile()`, `LogMonitor.stop()`, decloak callbacks, and status callbacks

- [ ] **Step 1: Write failing deterministic monitor tests**

Use temporary directories and an injected scheduler so tests call `reconcile()` directly. Cover these scenarios:

```ts
const events: DecloakEvent[] = [];
const statuses: MonitorStatus[] = [];
const monitor = new LogMonitor({
  directory,
  onDecloak: (event) => events.push(event),
  onStatus: (status) => statuses.push(status),
  reconcileIntervalMs: 0,
});

await monitor.start();
assert.equal(events.length, 0); // an old decloak already in an existing file

await appendFile(existingFile, newDecloakLine);
await monitor.reconcile();
assert.equal(events.length, 1);

await monitor.reconcile();
assert.equal(events.length, 1); // no duplicate callback
```

Add separate tests for:

- A log created after `start()` whose header and decloak are detected.
- Two character logs producing two correctly attributed events.
- Failed activation messages producing zero events.
- File deletion and replacement.
- Truncation followed by a new event.
- Missing and unreadable directories producing actionable statuses without throwing out of `start()`.
- Stop cancelling the watcher and reconciliation timer.

- [ ] **Step 2: Run monitor tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/core/log-monitor.test.ts
```

Expected: FAIL because `LogMonitor` does not exist.

- [ ] **Step 3: Implement monitoring and status contracts**

Expose:

```ts
export type MonitorStatus =
  | { kind: 'watching'; activeLogs: number }
  | { kind: 'waiting'; activeLogs: 0 }
  | { kind: 'error'; activeLogs: number; message: string };

export interface LogMonitorOptions {
  directory: string;
  onDecloak(event: DecloakEvent): void;
  onStatus(status: MonitorStatus): void;
  reconcileIntervalMs?: number;
}

export class LogMonitor {
  constructor(options: LogMonitorOptions);
  start(): Promise<void>;
  reconcile(): Promise<void>;
  stop(): Promise<void>;
}
```

During initial enumeration, open files in `existing` mode. After the initial set is recorded, Chokidar `add` events open genuinely new files in `new` mode. Reconciliation-discovered files use `existing` mode to prefer avoiding historical replay over guessing that a missed event was new. Serialize reads per path so overlapping `change` and reconciliation callbacks cannot advance the same cursor concurrently.

Use a 2-second default reconciliation interval and bounded watcher restart delays of 1, 2, 5, 10, and 30 seconds. After the fifth consecutive failure, retain periodic directory validation and emit an error until access returns.

- [ ] **Step 4: Run monitor tests and verify GREEN**

Run the Step 2 command and expect PASS.

- [ ] **Step 5: Run all core tests and commit**

Run:

```bash
npm test --prefix desktop/cloak-watch
git add desktop/cloak-watch/src/core
git commit -m "feat: monitor multiple EVE game logs"
```

Expected: all desktop tests PASS.

---

### Task 6: Coordinate settings, monitoring, and alerts

**Files:**
- Create: `desktop/cloak-watch/src/app/alert-service.test.ts`
- Create: `desktop/cloak-watch/src/app/alert-service.ts`
- Create: `desktop/cloak-watch/src/app/controller.test.ts`
- Create: `desktop/cloak-watch/src/app/controller.ts`
- Create: `desktop/cloak-watch/src/app/view-model.ts`

**Interfaces:**
- Consumes: `AppSettings`, `SettingsStore`, `LogMonitor`, and injected native adapters
- Produces: `AlertService`, `CloakWatchController`, and immutable `AppViewModel` updates for tray/settings UI

- [ ] **Step 1: Write failing alert-service tests**

Inject recording functions:

```ts
const calls: string[] = [];
const service = new AlertService({
  playPing: async () => calls.push('sound'),
  showNotification: async (title, body) => calls.push(`${title}|${body}`),
});

await service.deliver(event, {
  soundEnabled: true,
  notificationsEnabled: true,
});

assert.deepEqual(calls, [
  'sound',
  'EVE decloak detected — Cyrdax Prime|Your cloak deactivates due to proximity.',
]);
```

Assert each preference disables only its own channel. Make `playPing` reject and prove the notification still runs; make the notification reject and prove the sound still runs. Assert the returned result reports channel errors without throwing.

- [ ] **Step 2: Run alert tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/app/alert-service.test.ts
```

Expected: FAIL because `AlertService` does not exist.

- [ ] **Step 3: Implement independent alert channels**

Expose:

```ts
export interface AlertPreferences {
  soundEnabled: boolean;
  notificationsEnabled: boolean;
}

export interface AlertResult {
  soundError: string | null;
  notificationError: string | null;
}

export class AlertService {
  constructor(adapters: AlertAdapters);
  deliver(event: DecloakEvent, preferences: AlertPreferences): Promise<AlertResult>;
  test(preferences: AlertPreferences): Promise<AlertResult>;
}
```

`test()` must use character `Test alert`, current time, and message `Cloak Watch alerts are working.` without touching the log directory.

- [ ] **Step 4: Run alert tests and verify GREEN**

Run the Step 2 command and expect PASS.

- [ ] **Step 5: Write failing controller tests**

With fake settings, monitor, login-item, and alert adapters, assert:

- `start()` loads settings, discovers the conventional directory when no override exists, validates it, configures login startup, and starts one monitor.
- Missing default directory yields `Log folder not found` and requests the settings window once.
- `setLogDirectory(path)` rejects invalid paths, saves valid paths, stops the old monitor, and starts the new one.
- Monitor events call `AlertService.deliver`, update the latest-event line, and never cause an EVE focus/input callback because no such adapter exists.
- `setSoundEnabled`, `setNotificationsEnabled`, and `setStartAtLogin` persist immediately.
- A notification permission error leaves sound enabled and appears in the view model.
- `dispose()` stops monitoring.

The view-model contract is:

```ts
export interface AppViewModel {
  statusText: string;
  activeLogs: number;
  logDirectory: string | null;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  startAtLogin: boolean;
  latestEventText: string;
  warning: string | null;
}
```

Construct the controller through this dependency boundary so tests never initialize Electron:

```ts
export interface ControllerDependencies {
  settingsStore: SettingsStore;
  documentsDirectory: string;
  validateDirectory(path: string): Promise<DirectoryValidation>;
  createMonitor(options: LogMonitorOptions): LogMonitor;
  alertService: AlertService;
  setLoginItem(enabled: boolean): Promise<void>;
  onViewModel(viewModel: AppViewModel): void;
  requestShowSettings(): void;
  now(): Date;
}
```

- [ ] **Step 6: Run controller tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/app/controller.test.ts
```

Expected: FAIL because `CloakWatchController` does not exist.

- [ ] **Step 7: Implement the controller**

Expose methods with these exact signatures:

```ts
export class CloakWatchController {
  start(): Promise<void>;
  setLogDirectory(directory: string): Promise<void>;
  setSoundEnabled(enabled: boolean): Promise<void>;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  testAlert(): Promise<AlertResult>;
  getViewModel(): AppViewModel;
  dispose(): Promise<void>;
}
```

Accept all OS behavior through constructor-injected adapters. Do not add an adapter for focusing applications or sending input.

- [ ] **Step 8: Run app tests and commit**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/app/alert-service.test.ts src/app/controller.test.ts
git add desktop/cloak-watch/src/app
git commit -m "feat: coordinate cloak watch alerts"
```

Expected: focused tests PASS.

---

### Task 7: Add the secure Electron tray and settings interface

**Files:**
- Create: `desktop/cloak-watch/src/main/window-options.test.ts`
- Create: `desktop/cloak-watch/src/main/window-options.ts`
- Create: `desktop/cloak-watch/src/main/tray-template.test.ts`
- Create: `desktop/cloak-watch/src/main/tray-template.ts`
- Create: `desktop/cloak-watch/src/main/native-adapters.ts`
- Create: `desktop/cloak-watch/src/main/index.ts`
- Create: `desktop/cloak-watch/src/ui/preload.cjs`
- Create: `desktop/cloak-watch/src/ui/index.html`
- Create: `desktop/cloak-watch/src/ui/styles.css`
- Create: `desktop/cloak-watch/src/ui/renderer.js`

**Interfaces:**
- Consumes: `CloakWatchController`, Electron `Tray`, `Menu`, `BrowserWindow`, `Notification`, `dialog`, `shell`, and login-item APIs
- Produces: a single-instance tray application, local settings window, synthesized ping, native notification, and allowlisted IPC bridge

- [ ] **Step 1: Write failing BrowserWindow security tests**

Assert the pure options builder returns:

```ts
assert.deepEqual(createWindowWebPreferences('/app/preload.cjs'), {
  preload: '/app/preload.cjs',
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
});
```

Also assert the settings window starts hidden, has fixed minimum dimensions, and loads only the packaged `dist/ui/index.html` path supplied by the caller.

- [ ] **Step 2: Run window tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/main/window-options.test.ts
```

Expected: FAIL because the window-options module does not exist.

- [ ] **Step 3: Implement pure secure window options**

Use `import type { BrowserWindowConstructorOptions } from 'electron'` so the pure module can run under Node tests without initializing Electron. Do not expose navigation, remote URLs, arbitrary IPC names, `webview`, or shell execution to the renderer.

- [ ] **Step 4: Write failing tray-template tests**

Create a representative view model and assert labels, check states, disabled status/latest-event lines, and callback routing:

```ts
const menu = buildTrayTemplate(viewModel, actions);
assert.equal(menu[0].label, 'Watching 2 active logs');
assert.equal(menu.find((item) => item.label === 'Sound')?.checked, true);
assert.equal(menu.find((item) => item.label === 'Notifications')?.checked, true);
assert.equal(menu.at(-1)?.label, 'Quit');
```

Invoke each test callback and prove it calls only the corresponding action.

- [ ] **Step 5: Run tray tests and verify RED**

Run:

```bash
npm run test:focused --prefix desktop/cloak-watch -- src/main/tray-template.test.ts
```

Expected: FAIL because the tray-template module does not exist.

- [ ] **Step 6: Implement the tray template and native adapters**

The tray template order must match the design specification. Implement adapters for:

```ts
interface NativeAdapters {
  playPing(): Promise<void>;
  showNotification(title: string, body: string): Promise<void>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  chooseLogDirectory(): Promise<string | null>;
  openLogDirectory(path: string): Promise<void>;
  showSettings(): void;
  quit(): void;
}
```

`playPing()` sends only `cloak-watch:play-ping` to the local renderer. The renderer synthesizes two short sine tones with Web Audio. `showNotification()` checks support/permission and calls Electron's `Notification`. The folder picker uses `openDirectory`; opening the folder uses `shell.openPath` and reports non-empty error strings.

- [ ] **Step 7: Implement the allowlisted preload and local settings UI**

Expose exactly this renderer API from `preload.cjs`:

```js
contextBridge.exposeInMainWorld('cloakWatch', {
  getState: () => ipcRenderer.invoke('cloak-watch:get-state'),
  chooseLogDirectory: () => ipcRenderer.invoke('cloak-watch:choose-log-directory'),
  setSoundEnabled: (enabled) => ipcRenderer.invoke('cloak-watch:set-sound', Boolean(enabled)),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke('cloak-watch:set-notifications', Boolean(enabled)),
  setStartAtLogin: (enabled) => ipcRenderer.invoke('cloak-watch:set-start-at-login', Boolean(enabled)),
  testAlert: () => ipcRenderer.invoke('cloak-watch:test-alert'),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('cloak-watch:state', handler);
    return () => ipcRenderer.removeListener('cloak-watch:state', handler);
  },
  onPlayPing: (listener) => {
    ipcRenderer.on('cloak-watch:play-ping', listener);
    return () => ipcRenderer.removeListener('cloak-watch:play-ping', listener);
  },
});
```

The HTML must include a restrictive CSP, monitoring status, selected directory, three toggles, `Choose log folder`, `Test alert`, the latest event, and the approved compliance text. The renderer must use `textContent`, never `innerHTML`, for log-derived values.

- [ ] **Step 8: Wire the Electron main process**

In `index.ts`:

- Acquire `app.requestSingleInstanceLock()` and focus only the Cloak Watch settings window on a second app launch; never focus EVE.
- Set a stable Windows AppUserModelId.
- Create one hidden settings/audio window after `app.whenReady()`.
- Use the copied `build/icon.png` for app/notification identity and a 16px native image for the tray.
- Construct `SettingsStore`, `AlertService`, and `CloakWatchController` with Electron adapters.
- Rebuild the tray and push the view model to the renderer on each controller update.
- Show settings automatically only when the log directory is missing/unreadable.
- Hide the settings window on close; quit only from the tray or OS shutdown.
- Dispose the monitor during `before-quit`.
- Register only the seven IPC channels listed in the preload contract.

- [ ] **Step 9: Run desktop checks and commit**

Run:

```bash
npm test --prefix desktop/cloak-watch
npm run typecheck --prefix desktop/cloak-watch
npm run build --prefix desktop/cloak-watch
git add desktop/cloak-watch/src desktop/cloak-watch/scripts
git commit -m "feat: add cloak watch tray interface"
```

Expected: tests, typecheck, and build all PASS. `dist/ui/` contains only packaged local files.

---

### Task 8: Add native packaging, CI artifacts, and user documentation

**Files:**
- Modify: `src/cloak-watch-package.test.ts`
- Create: `.github/workflows/cloak-watch.yml`
- Create: `desktop/cloak-watch/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the standalone desktop scripts and existing Outfit420 icon
- Produces: unsigned macOS DMG/ZIP and Windows NSIS/portable artifacts plus installation/risk documentation

- [ ] **Step 1: Expand the structural test and verify RED**

Add assertions that:

```ts
const workflow = await readFile(
  new URL('../.github/workflows/cloak-watch.yml', import.meta.url),
  'utf8',
);
assert.match(workflow, /macos-latest/);
assert.match(workflow, /windows-latest/);
assert.match(workflow, /npm ci/);
assert.match(workflow, /npm test/);
assert.match(workflow, /npm run typecheck/);
assert.match(workflow, /package_script: package:mac/);
assert.match(workflow, /package_script: package:win/);
assert.match(workflow, /npm run \$\{\{ matrix\.package_script \}\}/);
assert.doesNotMatch(workflow, /ubuntu-latest/);
```

Run:

```bash
node --import tsx --test src/cloak-watch-package.test.ts
```

Expected: FAIL because the workflow does not exist.

- [ ] **Step 2: Add the native GitHub Actions matrix**

Create `.github/workflows/cloak-watch.yml` with:

```yaml
name: Cloak Watch Desktop

on:
  pull_request:
    paths:
      - 'desktop/cloak-watch/**'
      - '.github/workflows/cloak-watch.yml'
      - 'src/cloak-watch-package.test.ts'
  push:
    branches: [main]
    tags: ['cloak-watch-v*']
    paths:
      - 'desktop/cloak-watch/**'
      - '.github/workflows/cloak-watch.yml'
      - 'src/cloak-watch-package.test.ts'

permissions:
  contents: write

jobs:
  package:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            package_script: package:mac
            publish_script: publish:mac
            artifact_name: cloak-watch-macos
          - os: windows-latest
            package_script: package:win
            publish_script: publish:win
            artifact_name: cloak-watch-windows
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: desktop/cloak-watch
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: desktop/cloak-watch/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - name: Package branch artifact
        if: ${{ !startsWith(github.ref, 'refs/tags/cloak-watch-v') }}
        run: npm run ${{ matrix.package_script }}
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      - name: Package and publish draft release
        if: ${{ startsWith(github.ref, 'refs/tags/cloak-watch-v') }}
        run: npm run ${{ matrix.publish_script }}
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}
          path: desktop/cloak-watch/release/**
          if-no-files-found: error
```

The ordinary branch path uses `--publish never`. A tag matching `cloak-watch-v*` uses `--publish always` with the repository token, and the package's `releaseType: draft` configuration keeps the GitHub release unpublished until both native artifacts have been inspected.

- [ ] **Step 3: Write the desktop README and root link**

Document:

- What Cloak Watch detects and what it cannot know.
- Conventional macOS/Windows log path and manual folder selection.
- Tray controls and Test Alert.
- Start-at-login behavior.
- Local-only data flow and absence of network access.
- The explicit no-automation boundary.
- CCP's third-party-tool risk language with links to CCP Third Party Policies and Third-party Applications guidance.
- Unsigned macOS and Windows warnings, including safe per-app opening steps without disabling Gatekeeper or SmartScreen globally.
- Development commands and native packaging commands.
- Tag format `cloak-watch-v0.1.0`.

Add a short `Cloak Watch desktop companion` section to the root README linking to `desktop/cloak-watch/README.md`.

- [ ] **Step 4: Run structural and desktop checks**

Run:

```bash
node --import tsx --test src/cloak-watch-package.test.ts
npm test --prefix desktop/cloak-watch
npm run typecheck --prefix desktop/cloak-watch
npm run build --prefix desktop/cloak-watch
```

Expected: all commands PASS.

- [ ] **Step 5: Build the native macOS artifacts**

Run on the current macOS host:

```bash
npm run package:mac --prefix desktop/cloak-watch
```

Expected: `desktop/cloak-watch/release/` contains one `.dmg` and one `.zip`, and the packaged app launches after the normal unsigned-app approval flow.

- [ ] **Step 6: Commit packaging and documentation**

Run:

```bash
git add .github/workflows/cloak-watch.yml desktop/cloak-watch/README.md README.md src/cloak-watch-package.test.ts
git commit -m "build: package cloak watch for macOS and Windows"
```

---

### Task 9: Verify behavior, security boundaries, and release readiness

**Files:**
- Modify only files required to correct failures found by the checks below

**Interfaces:**
- Consumes: the completed desktop package and root repository
- Produces: evidence that tests, types, build, packaging, and prohibited-capability scans pass

- [ ] **Step 1: Run the complete root and desktop test suites**

Run:

```bash
npm test
npm test --prefix desktop/cloak-watch
```

Expected: both suites PASS with zero failures.

- [ ] **Step 2: Verify both projects' types and builds**

Run:

```bash
npm run typecheck
npm run build
npm run typecheck --prefix desktop/cloak-watch
npm run build --prefix desktop/cloak-watch
```

Expected: all four commands PASS. The server build does not install or bundle Electron.

- [ ] **Step 3: Audit the no-network/no-automation boundary**

Run:

```bash
rg -n -i 'fetch\(|axios|http://|https://|websocket|robotjs|nut\.js|sendinput|keybd_event|cgEvent|osascript|powershell|child_process|process\.memory|readprocessmemory|packet|pcap|cache scraping' desktop/cloak-watch/src desktop/cloak-watch/package.json
```

Expected: no executable network, input automation, process-memory, packet, shell, or cache-scraping implementation. Allowed matches are limited to static compliance links in local HTML/README content and must not be invoked by application code.

- [ ] **Step 4: Perform a synthetic macOS smoke test**

Launch the development app against a temporary folder selected through the UI. Create one synthetic log containing a listener header, then append a known proximity decloak line. Verify one ping, one notification, the correct character/reason, and one latest-event update. Append a failed-activation line and verify silence. Restart and verify the previous decloak does not replay.

Run:

```bash
npm run dev --prefix desktop/cloak-watch
```

Expected: every observation above matches the acceptance criteria; the app never raises or controls EVE.

- [ ] **Step 5: Inspect repository state and dependency separation**

Run:

```bash
git status --short
git diff --check
node -e "const p=require('./package.json'); if (p.dependencies?.electron || p.devDependencies?.electron) process.exit(1)"
npm ls electron --depth=0 --prefix desktop/cloak-watch
```

Expected: the root package assertion exits zero; the desktop command reports `electron@44.4.5`; the tracked worktree is clean after any required fix commit.

- [ ] **Step 6: Commit any verification corrections**

If Step 1-5 required source corrections, rerun every failed check, stage the exact corrected paths shown by `git status --short`, and commit only those corrections:

```bash
git commit -m "fix: complete cloak watch verification"
```

If no corrections were required, do not create an empty commit.

The Windows installer is release-ready only after the `windows-latest` CI job passes and its uploaded NSIS and portable `.exe` artifacts are inspected. The first public stable tag must wait for one manual Windows install/test as required by the design specification.
