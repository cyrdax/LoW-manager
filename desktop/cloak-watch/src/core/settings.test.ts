import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_SETTINGS, SettingsStore, type SettingsFileSystem } from './settings.js';

async function inTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'cloak-watch-settings-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('SettingsStore returns the documented defaults before preferences have been saved', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = new SettingsStore(directory);

    assert.deepEqual((await store.load()).settings, {
      version: 1,
      logDirectory: null,
      soundEnabled: true,
      notificationsEnabled: true,
      startAtLogin: true,
    });
    assert.equal((await store.load()).warning, null);
  });
});

test('SettingsStore gives each missing-settings load an independent defaults object', async () => {
  await inTemporaryDirectory(async (directory) => {
    const firstResult = await new SettingsStore(join(directory, 'first-user-data')).load();
    firstResult.settings.soundEnabled = false;

    const secondResult = await new SettingsStore(join(directory, 'second-user-data')).load();
    assert.deepEqual(secondResult.settings, {
      version: 1,
      logDirectory: null,
      soundEnabled: true,
      notificationsEnabled: true,
      startAtLogin: true,
    });
  });
});

test('SettingsStore persists a saved preference for a newly constructed store', async () => {
  await inTemporaryDirectory(async (directory) => {
    const store = new SettingsStore(directory);
    await store.save({
      ...DEFAULT_SETTINGS,
      logDirectory: '/Users/test/Documents/EVE/logs/Gamelogs',
      soundEnabled: false,
    });

    const restartedStore = new SettingsStore(directory);
    assert.deepEqual(await restartedStore.load(), {
      settings: {
        version: 1,
        logDirectory: '/Users/test/Documents/EVE/logs/Gamelogs',
        soundEnabled: false,
        notificationsEnabled: true,
        startAtLogin: true,
      },
      warning: null,
    });
  });
});

test('SettingsStore quarantines malformed or unsupported persisted settings and recreates defaults', async () => {
  await inTemporaryDirectory(async (directory) => {
    const settingsPath = join(directory, 'settings.json');
    const corruptPath = join(directory, 'settings.json.corrupt');
    await writeFile(settingsPath, '{not valid JSON', 'utf8');

    const malformedResult = await new SettingsStore(directory).load();
    assert.deepEqual(malformedResult.settings, DEFAULT_SETTINGS);
    assert.match(malformedResult.warning ?? '', /settings/i);
    assert.equal(await readFile(corruptPath, 'utf8'), '{not valid JSON');
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), DEFAULT_SETTINGS);

    await writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, version: 2 }), 'utf8');
    const unsupportedResult = await new SettingsStore(directory).load();
    assert.deepEqual(unsupportedResult.settings, DEFAULT_SETTINGS);
    assert.match(unsupportedResult.warning ?? '', /version|settings/i);
    assert.deepEqual(JSON.parse(await readFile(corruptPath, 'utf8')), { ...DEFAULT_SETTINGS, version: 2 });
  });
});

test('SettingsStore writes a complete temporary file before atomically replacing settings', async () => {
  await inTemporaryDirectory(async (directory) => {
    const operations: string[] = [];
    const fileSystem: SettingsFileSystem = {
      async mkdir(path, options) {
        return (await import('node:fs/promises')).mkdir(path, options);
      },
      async readFile(path) {
        return readFile(path, 'utf8');
      },
      async writeFile(path, contents) {
        operations.push(`write:${path}`);
        await writeFile(path, contents, 'utf8');
      },
      async rename(from, to) {
        operations.push(`rename:${from}:${to}`);
        await rename(from, to);
      },
    };
    const store = new SettingsStore(directory, fileSystem);

    await store.save({ ...DEFAULT_SETTINGS, notificationsEnabled: false });

    const temporaryPath = join(directory, 'settings.json.tmp');
    const settingsPath = join(directory, 'settings.json');
    assert.deepEqual(operations, [
      `write:${temporaryPath}`,
      `rename:${temporaryPath}:${settingsPath}`,
    ]);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
      ...DEFAULT_SETTINGS,
      notificationsEnabled: false,
    });
  });
});
