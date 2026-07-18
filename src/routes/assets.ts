import type { FastifyInstance } from 'fastify';
import { createCurrentUserResolver, type CurrentUserResolver } from '../auth/current-user.ts';
import type { AsyncCharacterStore } from '../characters/store.ts';
import { createPostgresCharacterStore } from '../characters/store.ts';
import {
  refreshAllAssets,
  refreshPilotAssets,
  summarizeAssets,
  type RefreshAllAssetsInput,
  type RefreshPilotAssetsInput,
} from '../assets/refresh.ts';
import { createPostgresAssetSnapshotStore, type AssetSnapshotStore } from '../assets/store.ts';

export interface AssetsRouteDeps {
  currentUser?: CurrentUserResolver;
  characters?: Pick<AsyncCharacterStore, 'listByUser' | 'listUsableByUser' | 'getOwned'>;
  store?: AssetSnapshotStore;
  now?: () => number;
  refreshPilot?: (input: RefreshPilotAssetsInput) => Promise<Awaited<ReturnType<typeof refreshPilotAssets>>>;
  refreshAll?: (input: RefreshAllAssetsInput) => Promise<Awaited<ReturnType<typeof refreshAllAssets>>>;
}

export function registerAssetsRoutes(app: FastifyInstance, deps: AssetsRouteDeps = {}) {
  const currentUser = deps.currentUser ?? createCurrentUserResolver();
  const characters = deps.characters ?? createPostgresCharacterStore();
  const store = deps.store ?? createPostgresAssetSnapshotStore();
  const now = deps.now ?? (() => Date.now());
  const refreshPilot = deps.refreshPilot ?? refreshPilotAssets;
  const refreshAll = deps.refreshAll ?? refreshAllAssets;

  app.get('/api/assets', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const snapshots = await store.listSnapshots(user.id, now());
    return { dashboard: summarizeAssets(snapshots), pilots: snapshots };
  });

  app.post('/api/assets/characters/:characterId/refresh', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const characterId = Number((req.params as { characterId: string }).characterId);
    const character = Number.isFinite(characterId) ? await characters.getOwned(user.id, characterId) : undefined;
    if (!character) return reply.code(404).send({ error: 'character_not_found' });

    const snapshot = await refreshPilot({ userId: user.id, character, characterStore: characters, store, now });
    const snapshots = await store.listSnapshots(user.id, now());
    return { dashboard: summarizeAssets(snapshots), snapshot };
  });

  app.post('/api/assets/refresh', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const owned = await characters.listUsableByUser(user.id);
    const snapshots = await refreshAll({
      userId: user.id,
      characters: owned,
      characterStore: characters,
      store,
      now,
      concurrency: 2,
    });
    return { dashboard: summarizeAssets(await store.listSnapshots(user.id, now())), pilots: snapshots };
  });
}
