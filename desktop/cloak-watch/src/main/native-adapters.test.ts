import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAdapters, type NativeAdapterDependencies } from './native-adapters.js';

test('native adapters expose only the approved local desktop actions', async () => {
  const calls: string[] = [];
  const adapters = createNativeAdapters(recordingDependencies(calls));

  await adapters.playPing();
  await adapters.showNotification('Decloak', 'Cyrdax Prime');
  await adapters.setStartAtLogin(true);
  assert.equal(await adapters.chooseLogDirectory(), '/logs');
  await adapters.openLogDirectory('/logs');
  adapters.showSettings();
  adapters.quit();

  assert.deepEqual(calls, [
    'send:cloak-watch:play-ping',
    'notification:Decloak|Cyrdax Prime',
    'login:true',
    'choose-folder',
    'open:/logs',
    'show-settings',
    'quit',
  ]);
});

test('native notification and folder errors remain actionable', async () => {
  const dependencies = recordingDependencies([]);
  dependencies.notificationsSupported = () => false;
  dependencies.openPath = async () => 'Permission denied';
  const adapters = createNativeAdapters(dependencies);

  await assert.rejects(() => adapters.showNotification('Decloak', 'Pilot'), /not supported or permission was denied/i);
  await assert.rejects(() => adapters.openLogDirectory('/logs'), /Permission denied/);
});

function recordingDependencies(calls: string[]): NativeAdapterDependencies {
  return {
    sendToRenderer: (channel) => { calls.push(`send:${channel}`); },
    notificationsSupported: () => true,
    showNotification: (title, body) => { calls.push(`notification:${title}|${body}`); },
    setLoginItem: (enabled) => { calls.push(`login:${enabled}`); },
    chooseLogDirectory: async () => {
      calls.push('choose-folder');
      return '/logs';
    },
    openPath: async (path) => {
      calls.push(`open:${path}`);
      return '';
    },
    showSettings: () => { calls.push('show-settings'); },
    quit: () => { calls.push('quit'); },
  };
}
