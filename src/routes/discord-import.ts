import type { FastifyInstance } from 'fastify';
import {
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
} from '../auth/pilot-access.ts';
import {
  createDiscordApiClient,
  createDiscordImportService,
  type DiscordImportApplyAction,
  type DiscordImportService,
} from '../discord/import.ts';
import { createDefaultPyfaScreenshotExtractor, type PyfaScreenshotExtractor } from '../fits/pyfa-image-import.ts';
import type { AsyncFitStore, FitStore, LibraryVisibility } from '../fits/store.ts';

export interface DiscordImportRouteDeps {
  currentUser?: CurrentUserResolver;
  service?: DiscordImportService;
  fitStore?: FitStore | AsyncFitStore;
  pyfaScreenshotExtractor?: PyfaScreenshotExtractor;
}

export function registerDiscordImportRoutes(app: FastifyInstance, deps: DiscordImportRouteDeps = {}) {
  const currentUser = routeCurrentUser(deps);

  app.get('/api/discord/import/channels', async (_req, reply) => {
    const user = await requireUser(_req, reply, currentUser);
    if (!user) return reply;
    try {
      return await serviceFor(deps).listChannels();
    } catch (err) {
      return reply.code(errorStatus(err)).send({ error: errorMessage(err, 'failed to list Discord channels') });
    }
  });

  app.post('/api/discord/import/scan', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const body = req.body as { channelId?: string; channelLabel?: string; visibility?: string } | undefined;
    const channelId = cleanText(body?.channelId);
    const channelLabel = cleanText(body?.channelLabel);
    if (!channelId) return reply.code(400).send({ error: 'channelId is required' });
    if (!channelLabel) return reply.code(400).send({ error: 'channelLabel is required' });
    try {
      return await serviceFor(deps).scan({
        channelId,
        channelLabel,
        visibility: parseVisibility(body?.visibility),
        ownerUserId: user.id,
      });
    } catch (err) {
      return reply.code(errorStatus(err)).send({ error: errorMessage(err, 'failed to scan Discord channel') });
    }
  });

  app.post('/api/discord/import/apply', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const body = req.body as { visibility?: string; actions?: DiscordImportApplyAction[] } | undefined;
    if (!Array.isArray(body?.actions)) return reply.code(400).send({ error: 'actions are required' });
    try {
      return await serviceFor(deps).apply({
        ownerUserId: user.id,
        visibility: parseVisibility(body.visibility),
        actions: body.actions,
      });
    } catch (err) {
      return reply.code(errorStatus(err)).send({ error: errorMessage(err, 'failed to import Discord fits') });
    }
  });
}

function serviceFor(deps: DiscordImportRouteDeps): DiscordImportService {
  if (deps.service) return deps.service;
  const api = createDiscordApiClient({
    botToken: process.env.DISCORD_BOT_TOKEN,
    guildId: process.env.DISCORD_GUILD_ID,
  });
  if (!deps.fitStore) throw new Error('registerDiscordImportRoutes requires a fit store');
  return createDiscordImportService({
    api,
    fitStore: deps.fitStore,
    pyfaExtractor: deps.pyfaScreenshotExtractor ?? createDefaultPyfaScreenshotExtractor(),
  });
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseVisibility(raw: string | undefined): LibraryVisibility {
  return raw === 'public' ? 'public' : 'private';
}

function errorStatus(err: unknown): number {
  const message = errorMessage(err, '');
  if (message.includes('DISCORD_BOT_TOKEN') || message.includes('DISCORD_GUILD_ID')) return 503;
  if (message.includes('Discord API request failed with 401') || message.includes('Discord API request failed with 403')) return 403;
  if (message.includes('Discord API request failed with 404')) return 404;
  if (message.includes('Discord API request failed with 429')) return 429;
  return 400;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
