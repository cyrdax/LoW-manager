import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildFitDraft } from '../fits/assignment.ts';
import { createFitStore, migrateFitsDb } from '../fits/store.ts';
import {
  createDiscordImportService,
  DISCORD_IMAGE_SCAN_LIMIT,
  DISCORD_MESSAGE_LIMIT,
  type DiscordApiClient,
  type DiscordImportApplyInput,
} from './import.ts';

const paladin = `[Paladin, Fabricator]
Mega Pulse Laser II

Tracking Computer II

Heat Sink II`;

const kronos = `[Kronos, Fabricator]
Neutron Blaster Cannon II

Tracking Computer II

Magnetic Field Stabilizer II`;

function stores() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFitsDb(db);
  return createFitStore(db);
}

function api(overrides: Partial<DiscordApiClient> = {}): DiscordApiClient {
  return {
    listGuildChannels: async () => [],
    listActiveThreads: async () => [],
    listPublicArchivedThreads: async () => [],
    fetchMessages: async () => [],
    fetchAttachmentBase64: async () => {
      throw new Error('unexpected attachment fetch');
    },
    ...overrides,
  };
}

test('discord import service lists readable channels and threads alphabetically', async () => {
  const service = createDiscordImportService({
    api: api({
      listGuildChannels: async () => [
        { id: '2', name: 'z-fits', type: 0 },
        { id: '1', name: 'alpha', type: 0 },
        { id: '3', name: 'voice', type: 2 },
      ],
      listActiveThreads: async () => [
        { id: '11', name: 'Paladins', type: 11, parent_id: '2' },
        { id: '10', name: 'Dreads', type: 11, parent_id: '1' },
      ],
    }),
    fitStore: stores(),
    buildDraft: buildFitDraft,
  });

  const channels = await service.listChannels();

  assert.deepEqual(channels.map(channel => channel.label), [
    'alpha',
    'alpha / Dreads',
    'z-fits',
    'z-fits / Paladins',
  ]);
  assert.equal(channels.find(channel => channel.id === '10')?.type, 'thread');
  assert.equal(channels.find(channel => channel.id === '11')?.parentName, 'z-fits');
});

test('discord import scan reads last 100 messages and extracts text fits', async () => {
  const fitStore = stores();
  let requestedLimit = 0;
  const service = createDiscordImportService({
    api: api({
      fetchMessages: async (channelId, limit) => {
        assert.equal(channelId, 'channel-1');
        requestedLimit = limit;
        return [{
          id: 'msg-1',
          channel_id: 'channel-1',
          guild_id: 'guild-1',
          content: `Here is the fit:\n\n\`\`\`\n${paladin}\n\`\`\`\n\nUse this one.`,
          timestamp: '2026-07-29T12:00:00.000Z',
          author: { id: 'author-1', username: 'Wayne' },
          attachments: [],
        }];
      },
    }),
    fitStore,
    buildDraft: buildFitDraft,
  });

  const result = await service.scan({
    channelId: 'channel-1',
    channelLabel: 'fits',
    visibility: 'private',
    ownerUserId: 'user-a',
  });

  assert.equal(requestedLimit, DISCORD_MESSAGE_LIMIT);
  assert.equal(result.scannedMessages, 1);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].fits[0].fitName, 'Fabricator');
  assert.equal(result.groups[0].fits[0].shipName, 'Paladin');
  assert.equal(result.groups[0].fits[0].defaultAction.kind, 'create');
  assert.equal(result.groups[0].message.url, 'https://discord.com/channels/guild-1/channel-1/msg-1');
});

test('discord import scan caps pyfa screenshot OCR at 10 images and reports skipped images', async () => {
  const attachments = Array.from({ length: DISCORD_IMAGE_SCAN_LIMIT + 3 }, (_, index) => ({
    id: `att-${index}`,
    url: `https://cdn.discordapp.com/${index}.png`,
    content_type: 'image/png',
    filename: `${index}.png`,
  }));
  let fetched = 0;
  const service = createDiscordImportService({
    api: api({
      fetchMessages: async () => [{
        id: 'msg-1',
        channel_id: 'channel-1',
        guild_id: 'guild-1',
        content: '',
        timestamp: '2026-07-29T12:00:00.000Z',
        author: { id: 'author-1', username: 'Wayne' },
        attachments,
      }],
      fetchAttachmentBase64: async () => {
        fetched++;
        return 'AAAA';
      },
    }),
    fitStore: stores(),
    buildDraft: buildFitDraft,
    pyfaExtractor: {
      extract: async () => ({
        shipName: 'Kronos',
        fitName: 'Fabricator',
        warnings: [],
        sections: [{ role: 'high', items: [{ name: 'Neutron Blaster Cannon II' }] }],
      }),
    },
  });

  const result = await service.scan({
    channelId: 'channel-1',
    channelLabel: 'fits',
    visibility: 'private',
    ownerUserId: 'user-a',
  });

  assert.equal(fetched, DISCORD_IMAGE_SCAN_LIMIT);
  assert.equal(result.summary.imagesScanned, DISCORD_IMAGE_SCAN_LIMIT);
  assert.equal(result.summary.imagesSkipped, 3);
  assert.equal(result.groups[0].fits.length, DISCORD_IMAGE_SCAN_LIMIT);
});

test('discord import scan defaults duplicate hull and fit name to update existing', async () => {
  const fitStore = stores();
  const existing = fitStore.create({ rawEft: paladin, fitName: 'Fabricator', ownerUserId: 'user-a', visibility: 'private' });
  const service = createDiscordImportService({
    api: api({
      fetchMessages: async () => [{
        id: 'msg-1',
        channel_id: 'channel-1',
        guild_id: 'guild-1',
        content: paladin.replace('Heat Sink II', 'Heat Sink II\nHeat Sink II'),
        timestamp: '2026-07-29T12:00:00.000Z',
        author: { id: 'author-1', username: 'Wayne' },
        attachments: [],
      }],
    }),
    fitStore,
    buildDraft: buildFitDraft,
  });

  const result = await service.scan({
    channelId: 'channel-1',
    channelLabel: 'fits',
    visibility: 'private',
    ownerUserId: 'user-a',
  });

  assert.deepEqual(result.groups[0].fits[0].defaultAction, { kind: 'update', fitId: existing.id });
});

test('discord import apply creates updates and skips selected fits', async () => {
  const fitStore = stores();
  const existing = fitStore.create({ rawEft: paladin, fitName: 'Fabricator', notes: 'Keep my notes', ownerUserId: 'user-a', visibility: 'private' });
  const service = createDiscordImportService({
    api: api(),
    fitStore,
    buildDraft: buildFitDraft,
  });
  const input: DiscordImportApplyInput = {
    ownerUserId: 'user-a',
    visibility: 'private',
    actions: [
      {
        action: 'update',
        fitId: existing.id,
        rawEft: paladin.replace('Heat Sink II', 'Heat Sink II\nHeat Sink II'),
        fitName: 'Fabricator',
        source: { channelLabel: 'fits', authorName: 'Wayne', timestamp: '2026-07-29T12:00:00.000Z', messageUrl: 'https://discord.com/channels/g/c/m1' },
      },
      {
        action: 'create',
        rawEft: kronos,
        fitName: 'Fabricator',
        source: { channelLabel: 'fits', authorName: 'Wayne', timestamp: '2026-07-29T12:05:00.000Z', messageUrl: 'https://discord.com/channels/g/c/m2' },
      },
      {
        action: 'skip',
        rawEft: kronos,
        fitName: 'Skip Me',
        source: { channelLabel: 'fits', authorName: 'Wayne', timestamp: '2026-07-29T12:06:00.000Z', messageUrl: 'https://discord.com/channels/g/c/m3' },
      },
    ],
  };

  const result = await service.apply(input);

  assert.equal(result.updated.length, 1);
  assert.equal(result.created.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(fitStore.get(existing.id)?.rawEft.includes('Heat Sink II\nHeat Sink II'), true);
  assert.match(fitStore.get(existing.id)?.notes ?? '', /Keep my notes/);
  assert.match(fitStore.get(existing.id)?.notes ?? '', /Discord source: fits/);
});
