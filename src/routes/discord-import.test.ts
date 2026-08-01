import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerDiscordImportRoutes } from './discord-import.ts';
import type { DiscordImportService } from '../discord/import.ts';

const userA = { id: 'user-a', email: null, role: 'user' as const, status: 'active' as const };

function service(): DiscordImportService {
  return {
    listChannels: async () => [
      { id: 'chan-1', label: 'fits', type: 'channel', parentId: null, parentName: null },
      { id: 'thread-1', label: 'fits / marauders', type: 'thread', parentId: 'chan-1', parentName: 'fits' },
    ],
    scan: async input => ({
      channelId: input.channelId,
      channelLabel: input.channelLabel,
      scannedMessages: 1,
      warnings: [],
      summary: { fitsFound: 1, imagesFound: 0, imagesScanned: 0, imagesSkipped: 0 },
      groups: [{
        message: {
          id: 'msg-1',
          authorName: 'Wayne',
          timestamp: '2026-07-29T12:00:00.000Z',
          url: 'https://discord.com/channels/g/c/m',
          excerpt: 'fit',
        },
        warnings: [],
        fits: [{
          id: 'msg-1:text:0',
          rawEft: '[Paladin, Fabricator]\nMega Pulse Laser II',
          fitName: 'Fabricator',
          shipName: 'Paladin',
          shipTypeId: 28659,
          sourceType: 'eft-text',
          warnings: [],
          defaultAction: { kind: 'create' },
        }],
      }],
    }),
    apply: async () => ({
      created: [{ fitId: 1, fitName: 'Fabricator', shipName: 'Paladin' }],
      updated: [],
      skipped: [],
      failed: [],
    }),
  };
}

test('discord import routes require an authenticated app user', async () => {
  const app = Fastify();
  registerDiscordImportRoutes(app, { currentUser: async () => null, service: service() });

  for (const request of [
    { method: 'GET' as const, url: '/api/discord/import/channels' },
    { method: 'POST' as const, url: '/api/discord/import/scan', payload: { channelId: 'chan-1', channelLabel: 'fits' } },
    { method: 'POST' as const, url: '/api/discord/import/apply', payload: { actions: [] } },
  ]) {
    const res = await app.inject(request);
    assert.equal(res.statusCode, 401);
  }
});

test('GET /api/discord/import/channels returns selectable channels and threads', async () => {
  const app = Fastify();
  registerDiscordImportRoutes(app, { currentUser: async () => userA, service: service() });

  const res = await app.inject({ method: 'GET', url: '/api/discord/import/channels' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).map((row: { label: string }) => row.label), ['fits', 'fits / marauders']);
});

test('POST /api/discord/import/scan delegates visibility and user context', async () => {
  const app = Fastify();
  let seen: unknown;
  const fake = service();
  fake.scan = async input => {
    seen = input;
    return service().scan(input);
  };
  registerDiscordImportRoutes(app, { currentUser: async () => userA, service: fake });

  const res = await app.inject({
    method: 'POST',
    url: '/api/discord/import/scan',
    payload: { channelId: 'chan-1', channelLabel: 'fits', channelType: 'thread', visibility: 'public' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { channelId: 'chan-1', channelLabel: 'fits', channelType: 'thread', visibility: 'public', ownerUserId: 'user-a' });
  assert.equal(JSON.parse(res.body).summary.fitsFound, 1);
});

test('POST /api/discord/import/apply delegates selected actions', async () => {
  const app = Fastify();
  let actionCount = 0;
  const fake = service();
  fake.apply = async input => {
    actionCount = input.actions.length;
    assert.equal(input.ownerUserId, 'user-a');
    assert.equal(input.visibility, 'private');
    return service().apply(input);
  };
  registerDiscordImportRoutes(app, { currentUser: async () => userA, service: fake });

  const res = await app.inject({
    method: 'POST',
    url: '/api/discord/import/apply',
    payload: {
      visibility: 'private',
      actions: [{
        action: 'create',
        rawEft: '[Paladin, Fabricator]\nMega Pulse Laser II',
        fitName: 'Fabricator',
        source: { channelLabel: 'fits', authorName: 'Wayne', timestamp: '2026-07-29T12:00:00.000Z', messageUrl: 'https://discord.com/channels/g/c/m' },
      }],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(actionCount, 1);
  assert.equal(JSON.parse(res.body).created[0].fitName, 'Fabricator');
});

test('discord import routes report missing configuration clearly', async () => {
  const app = Fastify();
  registerDiscordImportRoutes(app, { currentUser: async () => userA });

  const res = await app.inject({ method: 'GET', url: '/api/discord/import/channels' });

  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /DISCORD_BOT_TOKEN|DISCORD_GUILD_ID/);
});
