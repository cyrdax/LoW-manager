import assert from 'node:assert/strict';
import test from 'node:test';

import { AlertService } from './alert-service.js';
import type { DecloakEvent } from '../core/types.js';

const event: DecloakEvent = {
  characterName: 'Cyrdax Prime',
  occurredAt: '2026-09-23T03:04:05.000Z',
  message: 'Your cloak deactivates due to proximity.',
  sourceFile: '/logs/GameLog.txt',
  byteOffset: 99,
};

test('AlertService delivers enabled sound and notification channels with the decloak event details', async () => {
  const calls: string[] = [];
  const service = new AlertService({
    playPing: async () => { calls.push('sound'); },
    showNotification: async (title, body) => { calls.push(`${title}|${body}`); },
  });

  const result = await service.deliver(event, { soundEnabled: true, notificationsEnabled: true });

  assert.deepEqual(calls, [
    'sound',
    'EVE decloak detected — Cyrdax Prime|Your cloak deactivates due to proximity.',
  ]);
  assert.deepEqual(result, { soundError: null, notificationError: null });
});

test('AlertService disables each alert channel independently', async () => {
  const calls: string[] = [];
  const service = new AlertService({
    playPing: async () => { calls.push('sound'); },
    showNotification: async () => { calls.push('notification'); },
  });

  await service.deliver(event, { soundEnabled: false, notificationsEnabled: true });
  await service.deliver(event, { soundEnabled: true, notificationsEnabled: false });

  assert.deepEqual(calls, ['notification', 'sound']);
});

test('AlertService contains a sound failure while delivering the notification', async () => {
  const calls: string[] = [];
  const service = new AlertService({
    playPing: async () => { throw new Error('speaker unavailable'); },
    showNotification: async () => { calls.push('notification'); },
  });

  const result = await service.deliver(event, { soundEnabled: true, notificationsEnabled: true });

  assert.deepEqual(calls, ['notification']);
  assert.deepEqual(result, { soundError: 'speaker unavailable', notificationError: null });
});

test('AlertService contains a notification failure while delivering sound', async () => {
  const calls: string[] = [];
  const service = new AlertService({
    playPing: async () => { calls.push('sound'); },
    showNotification: async () => { throw new Error('permission denied'); },
  });

  const result = await service.deliver(event, { soundEnabled: true, notificationsEnabled: true });

  assert.deepEqual(calls, ['sound']);
  assert.deepEqual(result, { soundError: null, notificationError: 'permission denied' });
});

test('AlertService test alert uses the documented character and message', async () => {
  const notifications: Array<{ title: string; body: string }> = [];
  const service = new AlertService({
    playPing: async () => undefined,
    showNotification: async (title, body) => { notifications.push({ title, body }); },
  });

  const result = await service.test({ soundEnabled: false, notificationsEnabled: true });

  assert.deepEqual(notifications, [{
    title: 'EVE decloak detected — Test alert',
    body: 'Cloak Watch alerts are working.',
  }]);
  assert.deepEqual(result, { soundError: null, notificationError: null });
});
