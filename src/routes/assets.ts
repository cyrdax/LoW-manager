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
import { ASSET_STALE_MS, type AssetPilotStatus, type AssetSnapshot } from '../assets/types.ts';

const STRUCTURE_SCOPE = 'esi-universe.read_structures.v1';
const STRUCTURE_SCOPE_HINT = 'Re-auth this pilot with the structure scope esi-universe.read_structures.v1 to resolve player structure names.';

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

    const currentTime = now();
    const snapshots = await store.listSnapshots(user.id, currentTime);
    const pilots = mergeAssetRoster(await characters.listByUser(user.id), snapshots, currentTime);
    return { dashboard: summarizeAssets(pilots), pilots };
  });

  app.post('/api/assets/characters/:characterId/refresh', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const characterId = parseCharacterId((req.params as { characterId: string }).characterId);
    if (characterId == null) return reply.code(400).send({ error: 'invalid_character_id' });

    const character = await characters.getOwned(user.id, characterId);
    if (!character) return reply.code(404).send({ error: 'character_not_found' });

    const structureCharacterIds = (await characters.listUsableByUser(user.id)).map(pilot => pilot.character_id);
    const snapshot = await refreshPilot({ userId: user.id, character, characterStore: characters, store, now, structureCharacterIds });
    const currentTime = now();
    const snapshots = await store.listSnapshots(user.id, currentTime);
    const pilots = mergeAssetRoster(await characters.listByUser(user.id), snapshots, currentTime);
    return { dashboard: summarizeAssets(pilots), pilots, snapshot };
  });

  app.post('/api/assets/refresh', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const owned = await characters.listUsableByUser(user.id);
    await refreshAll({
      userId: user.id,
      characters: owned,
      characterStore: characters,
      store,
      now,
      concurrency: 2,
    });
    const currentTime = now();
    const snapshots = await store.listSnapshots(user.id, currentTime);
    const pilots = mergeAssetRoster(await characters.listByUser(user.id), snapshots, currentTime);
    return { dashboard: summarizeAssets(pilots), pilots };
  });
}

function parseCharacterId(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const characterId = Number(value);
  return Number.isSafeInteger(characterId) && String(characterId) === value ? characterId : undefined;
}

function mergeAssetRoster(
  characters: Awaited<ReturnType<AsyncCharacterStore['listByUser']>>,
  snapshots: AssetSnapshot[],
  now: number,
): AssetSnapshot[] {
  const snapshotsByCharacterId = new Map(snapshots.map(snapshot => [snapshot.pilot.characterId, snapshot]));
  return characters.map(character => {
    const snapshot = snapshotsByCharacterId.get(character.character_id);
    const authorizationStatus = currentAuthorizationStatus(character);
    const restoredStatus = snapshot && !authorizationStatus ? restoredAuthorizationStatus(snapshot, now) : undefined;
    if (!snapshot) return emptySnapshotFor(character.character_id, character.character_name, placeholderStatus(character));

    const merged = {
        ...snapshot,
        pilot: {
          ...snapshot.pilot,
          characterName: character.character_name,
          ...(authorizationStatus ? { status: authorizationStatus, error: null } : restoredStatus ? { status: restoredStatus, error: null } : {}),
        },
      };
    return authorizationStatus ? merged : withStructureScopeNotice(merged, character);
  });
}

function currentAuthorizationStatus(
  character: Awaited<ReturnType<AsyncCharacterStore['listByUser']>>[number],
): Extract<AssetPilotStatus, 'Missing asset scope' | 'Needs re-auth'> | undefined {
  if (character.needs_reauth === 1) return 'Needs re-auth';
  if (!hasScope(character.scopes, 'esi-assets.read_assets.v1')) return 'Missing asset scope';
  return undefined;
}

function withStructureScopeNotice(
  snapshot: AssetSnapshot,
  character: Awaited<ReturnType<AsyncCharacterStore['listByUser']>>[number],
): AssetSnapshot {
  if (hasScope(character.scopes, STRUCTURE_SCOPE) || !hasUnresolvedStructures(snapshot)) return snapshot;
  return {
    ...snapshot,
    pilot: {
      ...snapshot.pilot,
      error: STRUCTURE_SCOPE_HINT,
    },
    locations: snapshot.locations.map(location => isUnresolvedStructure(location)
      ? { ...location, hint: location.hint ?? STRUCTURE_SCOPE_HINT }
      : location),
  };
}

function hasScope(scopes: string, scope: string): boolean {
  return scopes.split(/\s+/).includes(scope);
}

function hasUnresolvedStructures(snapshot: AssetSnapshot): boolean {
  return snapshot.locations.some(isUnresolvedStructure);
}

function isUnresolvedStructure(location: AssetSnapshot['locations'][number]): boolean {
  return location.status === 'unresolved' && (location.type === 'structure' || location.locationId >= 1_000_000_000);
}

function restoredAuthorizationStatus(snapshot: AssetSnapshot, now: number): AssetPilotStatus | undefined {
  if (snapshot.pilot.status !== 'Missing asset scope' && snapshot.pilot.status !== 'Needs re-auth') return undefined;
  if (snapshot.pilot.lastRefreshedAt == null) return 'Needs refresh';
  return now - snapshot.pilot.lastRefreshedAt > ASSET_STALE_MS ? 'Stale' : 'Ready';
}

function placeholderStatus(character: Awaited<ReturnType<AsyncCharacterStore['listByUser']>>[number]): AssetPilotStatus {
  const authorizationStatus = currentAuthorizationStatus(character);
  if (authorizationStatus) return authorizationStatus;
  return 'Needs refresh';
}

function emptySnapshotFor(characterId: number, characterName: string, status: AssetPilotStatus): AssetSnapshot {
  return {
    pilot: {
      characterId,
      characterName,
      status,
      error: null,
      lastRefreshedAt: null,
      locationCount: 0,
      itemCount: 0,
      stackCount: 0,
      pricedValue: 0,
      totalValue: 0,
      unpricedStacks: 0,
    },
    locations: [],
    categories: [],
  };
}
