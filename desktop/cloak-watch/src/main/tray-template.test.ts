import assert from 'node:assert/strict';
import test from 'node:test';
import type { MenuItemConstructorOptions } from 'electron';
import type { AppViewModel } from '../app/view-model.js';
import { buildTrayTemplate, type TrayActions } from './tray-template.js';

const viewModel: AppViewModel = {
  statusText: 'Watching 2 logs',
  activeLogs: 2,
  logDirectory: '/Users/pilot/Documents/EVE/logs/Gamelogs',
  soundEnabled: true,
  notificationsEnabled: true,
  startAtLogin: false,
  latestEventText: 'Cyrdax Prime — Your cloak deactivates due to proximity.',
  warning: null,
};

test('tray template presents monitoring status, preferences, latest event, and quit in the documented order', () => {
  const menu = buildTrayTemplate(viewModel, recordingActions([]));

  assert.equal(menu[0]?.label, 'Watching 2 active logs');
  assert.equal(find(menu, 'Sound')?.checked, true);
  assert.equal(find(menu, 'Notifications')?.checked, true);
  assert.equal(find(menu, 'Start at login')?.checked, false);
  assert.equal(find(menu, viewModel.latestEventText)?.enabled, false);
  assert.equal(menu.at(-1)?.label, 'Quit');
});

test('tray actions route only to their matching controller or native action', async () => {
  const calls: string[] = [];
  const menu = buildTrayTemplate(viewModel, recordingActions(calls));

  await click(find(menu, 'Sound'));
  await click(find(menu, 'Notifications'));
  await click(find(menu, 'Start at login'));
  await click(find(menu, 'Test alert'));
  await click(find(menu, 'Open settings'));
  await click(find(menu, 'Open log folder'));
  await click(find(menu, 'Quit'));

  assert.deepEqual(calls, [
    'sound:false',
    'notifications:false',
    'login:true',
    'test',
    'settings',
    'folder',
    'quit',
  ]);
});

test('tray disables opening the log folder and explains an empty session', () => {
  const menu = buildTrayTemplate({
    ...viewModel,
    logDirectory: null,
    latestEventText: '',
    activeLogs: 0,
    statusText: 'Waiting for EVE game logs',
  }, recordingActions([]));

  assert.equal(find(menu, 'Open log folder')?.enabled, false);
  assert.equal(find(menu, 'No decloak detected this session')?.enabled, false);
});

function recordingActions(calls: string[]): TrayActions {
  return {
    setSoundEnabled: async (enabled) => { calls.push(`sound:${enabled}`); },
    setNotificationsEnabled: async (enabled) => { calls.push(`notifications:${enabled}`); },
    setStartAtLogin: async (enabled) => { calls.push(`login:${enabled}`); },
    testAlert: async () => { calls.push('test'); },
    openSettings: () => { calls.push('settings'); },
    openLogDirectory: async () => { calls.push('folder'); },
    quit: () => { calls.push('quit'); },
  };
}

function find(menu: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined {
  return menu.find((item) => item.label === label);
}

async function click(item: MenuItemConstructorOptions | undefined): Promise<void> {
  assert.ok(item?.click, `Missing clickable tray item: ${item?.label ?? 'unknown'}`);
  await item.click({} as never, undefined, {} as never);
}
