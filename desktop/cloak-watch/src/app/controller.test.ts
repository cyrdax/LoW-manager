import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { AlertService } from './alert-service.js';
import { CloakWatchController } from './controller.js';
import type { AppViewModel } from './view-model.js';
import { DEFAULT_SETTINGS, type AppSettings, type SettingsLoadResult, type SettingsStore } from '../core/settings.js';
import type { DirectoryValidation } from '../core/log-directory.js';
import type { LogMonitor, LogMonitorOptions, MonitorStatus } from '../core/log-monitor.js';
import type { DecloakEvent } from '../core/types.js';

const documentsDirectory = '/Users/test/Documents';
const defaultDirectory = join(documentsDirectory, 'EVE', 'logs', 'Gamelogs');
const event: DecloakEvent = {
  characterName: 'Cyrdax Prime',
  occurredAt: '2026-09-23T03:04:05.000Z',
  message: 'Your cloak deactivates due to proximity.',
  sourceFile: '/logs/GameLog.txt',
  byteOffset: 99,
};

class FakeSettings {
  readonly saves: AppSettings[] = [];
  saveError: Error | null = null;

  constructor(private result: SettingsLoadResult = { settings: { ...DEFAULT_SETTINGS }, warning: null }) {}

  async load(): Promise<SettingsLoadResult> {
    return { settings: { ...this.result.settings }, warning: this.result.warning };
  }

  async save(settings: AppSettings): Promise<void> {
    if (this.saveError) throw this.saveError;
    this.saves.push({ ...settings });
    this.result = { settings: { ...settings }, warning: null };
  }

  asStore(): SettingsStore {
    return this as unknown as SettingsStore;
  }
}

class FakeMonitor {
  starts = 0;
  stops = 0;

  constructor(readonly options: LogMonitorOptions) {}

  async start(): Promise<void> { this.starts++; }
  async stop(): Promise<void> { this.stops++; }
  decloak(value: DecloakEvent): void { this.options.onDecloak(value); }
  status(value: MonitorStatus): void { this.options.onStatus(value); }

  asMonitor(): LogMonitor {
    return this as unknown as LogMonitor;
  }
}

function createFixture(overrides: {
  settings?: FakeSettings;
  validateDirectory?: (path: string) => Promise<DirectoryValidation>;
  playPing?: () => Promise<void>;
  showNotification?: (title: string, body: string) => Promise<void>;
} = {}) {
  const settings = overrides.settings ?? new FakeSettings();
  const monitors: FakeMonitor[] = [];
  const loginStates: boolean[] = [];
  const viewModels: AppViewModel[] = [];
  let settingsRequests = 0;
  const controller = new CloakWatchController({
    settingsStore: settings.asStore(),
    documentsDirectory,
    validateDirectory: overrides.validateDirectory ?? (async () => ({ ok: true })),
    createMonitor: (options) => {
      const monitor = new FakeMonitor(options);
      monitors.push(monitor);
      return monitor.asMonitor();
    },
    alertService: new AlertService({
      playPing: overrides.playPing ?? (async () => undefined),
      showNotification: overrides.showNotification ?? (async () => undefined),
    }),
    setLoginItem: async (enabled) => { loginStates.push(enabled); },
    onViewModel: (viewModel) => { viewModels.push(viewModel); },
    requestShowSettings: () => { settingsRequests++; },
    now: () => new Date('2026-09-23T03:04:05.000Z'),
  });
  return { controller, settings, monitors, loginStates, viewModels, settingsRequests: () => settingsRequests };
}

test('CloakWatchController loads settings, discovers the conventional directory, configures login, and starts one monitor', async () => {
  const fixture = createFixture();

  await fixture.controller.start();

  assert.deepEqual(fixture.loginStates, [true]);
  assert.equal(fixture.monitors.length, 1);
  assert.equal(fixture.monitors[0].starts, 1);
  assert.equal(fixture.monitors[0].options.directory, defaultDirectory);
  assert.deepEqual(fixture.controller.getViewModel(), {
    statusText: 'Waiting for EVE game logs',
    activeLogs: 0,
    logDirectory: defaultDirectory,
    soundEnabled: true,
    notificationsEnabled: true,
    startAtLogin: true,
    latestEventText: '',
    warning: null,
  });
});

test('CloakWatchController surfaces settings recovery warnings without preventing monitoring', async () => {
  const fixture = createFixture({
    settings: new FakeSettings({ settings: { ...DEFAULT_SETTINGS }, warning: 'Settings were reset after recovery.' }),
  });

  await fixture.controller.start();

  assert.equal(fixture.monitors.length, 1);
  assert.equal(fixture.controller.getViewModel().warning, 'Settings were reset after recovery.');
});

test('CloakWatchController asks for settings once when the conventional directory is missing', async () => {
  const fixture = createFixture({ validateDirectory: async () => ({ ok: false, reason: 'not-found' }) });

  await fixture.controller.start();

  assert.equal(fixture.monitors.length, 0);
  assert.equal(fixture.settingsRequests(), 1);
  assert.equal(fixture.controller.getViewModel().warning, 'Log folder not found');
});

test('CloakWatchController rejects invalid directories and replaces a monitor only after saving a valid selection', async () => {
  const validation = new Map<string, DirectoryValidation>([
    [defaultDirectory, { ok: true }],
    ['/invalid', { ok: false, reason: 'not-directory' }],
    ['/manual', { ok: true }],
  ]);
  const fixture = createFixture({ validateDirectory: async (path) => validation.get(path) ?? { ok: false, reason: 'not-found' } });
  await fixture.controller.start();

  await assert.rejects(fixture.controller.setLogDirectory('/invalid'), /not a directory/i);
  assert.equal(fixture.settings.saves.length, 0);
  assert.equal(fixture.monitors.length, 1);

  await fixture.controller.setLogDirectory('/manual');

  assert.deepEqual(fixture.settings.saves, [{ ...DEFAULT_SETTINGS, logDirectory: '/manual' }]);
  assert.equal(fixture.monitors[0].stops, 1);
  assert.equal(fixture.monitors.length, 2);
  assert.equal(fixture.monitors[1].starts, 1);
  assert.equal(fixture.monitors[1].options.directory, '/manual');
});

test('CloakWatchController delivers monitor events through alert adapters and exposes the latest event', async () => {
  const calls: string[] = [];
  const fixture = createFixture({
    playPing: async () => { calls.push('sound'); },
    showNotification: async (title, body) => { calls.push(`${title}|${body}`); },
  });
  await fixture.controller.start();

  fixture.monitors[0].decloak(event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ['sound', 'EVE decloak detected — Cyrdax Prime|Your cloak deactivates due to proximity.']);
  assert.equal(fixture.controller.getViewModel().latestEventText, 'Cyrdax Prime — Your cloak deactivates due to proximity.');
});

test('CloakWatchController persists preference changes and keeps sound enabled when notification permission fails', async () => {
  let notificationFailure: Error | null = new Error('notification permission denied');
  const fixture = createFixture({
    showNotification: async () => {
      if (notificationFailure) throw notificationFailure;
    },
  });
  await fixture.controller.start();

  await fixture.controller.setSoundEnabled(false);
  await fixture.controller.setNotificationsEnabled(false);
  await fixture.controller.setStartAtLogin(false);
  await fixture.controller.setSoundEnabled(true);
  await fixture.controller.setNotificationsEnabled(true);
  fixture.monitors[0].decloak(event);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.settings.saves.map((settings) => [
    settings.soundEnabled,
    settings.notificationsEnabled,
    settings.startAtLogin,
  ]), [[false, true, true], [false, false, true], [false, false, false], [true, false, false], [true, true, false]]);
  assert.deepEqual(fixture.loginStates, [true, false]);
  assert.equal(fixture.controller.getViewModel().soundEnabled, true);
  assert.equal(fixture.controller.getViewModel().warning, 'notification permission denied');

  fixture.monitors[0].status({ kind: 'watching', activeLogs: 2 });
  assert.equal(
    fixture.controller.getViewModel().warning,
    'notification permission denied',
    'healthy monitor reconciliation must not erase an unresolved alert error',
  );

  notificationFailure = null;
  await fixture.controller.testAlert();
  assert.equal(fixture.controller.getViewModel().warning, null);

  notificationFailure = new Error('notification permission denied');
  fixture.monitors[0].decloak(event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.controller.getViewModel().warning, 'notification permission denied');

  await fixture.controller.setNotificationsEnabled(false);
  assert.equal(fixture.controller.getViewModel().warning, null);
});

test('CloakWatchController contains preference persistence errors and retains the saved preference', async () => {
  const settings = new FakeSettings();
  settings.saveError = new Error('disk full');
  const fixture = createFixture({ settings });
  await fixture.controller.start();

  await fixture.controller.setSoundEnabled(false);

  assert.equal(fixture.controller.getViewModel().soundEnabled, true);
  assert.equal(fixture.controller.getViewModel().warning, 'Unable to save settings: disk full');
});

test('CloakWatchController testAlert uses alert preferences without restarting the monitor', async () => {
  const calls: string[] = [];
  const fixture = createFixture({
    playPing: async () => { calls.push('sound'); },
    showNotification: async (title, body) => { calls.push(`${title}|${body}`); },
  });
  await fixture.controller.start();

  const result = await fixture.controller.testAlert();

  assert.deepEqual(result, { soundError: null, notificationError: null });
  assert.deepEqual(calls, ['sound', 'EVE decloak detected — Test alert|Cloak Watch alerts are working.']);
  assert.equal(fixture.monitors.length, 1);
});

test('CloakWatchController publishes immutable view-model snapshots and cleans up subscriptions', async () => {
  const fixture = createFixture();
  await fixture.controller.start();
  const snapshots: AppViewModel[] = [];
  const unsubscribe = fixture.controller.subscribe((viewModel) => { snapshots.push(viewModel); });

  assert.ok(Object.isFrozen(snapshots[0]));
  assert.throws(() => { snapshots[0].soundEnabled = false; }, TypeError);
  await fixture.controller.setSoundEnabled(false);
  unsubscribe();
  await fixture.controller.setSoundEnabled(true);

  assert.deepEqual(snapshots.map((viewModel) => viewModel.soundEnabled), [true, false]);
});

test('CloakWatchController stops the active monitor when disposed', async () => {
  const fixture = createFixture();
  await fixture.controller.start();

  await fixture.controller.dispose();

  assert.equal(fixture.monitors[0].stops, 1);
});
