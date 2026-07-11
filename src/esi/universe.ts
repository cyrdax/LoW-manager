import { esiGet, esiGetPublic, esiPostPublic } from './client.ts';
import { createUniverseCacheStore, type CorporationInfo } from './universe-cache-store.ts';

const privateStructureNames = new Map<string, string>();

function cache() {
  return createUniverseCacheStore();
}

async function cached(category: string, id: number): Promise<string | null> {
  return cache().getName(category, id);
}

async function store(category: string, id: number, name: string): Promise<void> {
  await cache().setName(category, id, name);
}

export async function resolveSystem(id: number): Promise<string> {
  const hit = await cached('system', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/systems/${id}/`);
  await store('system', id, data.name);
  return data.name;
}

/**
 * Bulk-fetch all solar system IDs and resolve their names, seeding the universe_names cache.
 * Idempotent; cheap after first run because subsequent runs see the cache is already populated.
 */
export async function bootstrapSystemsCache(): Promise<number> {
  const names = cache();
  const existing = await names.countNames('system');
  if (existing > 7000) return existing; // New Eden has ~8k+ K-space + W-space systems; skip if we clearly have them

  const { data: ids } = await esiGetPublic<number[]>(`/universe/systems/`);
  const missing = await names.missingNameIds('system', ids);

  // /universe/names/ accepts up to 1000 IDs per call
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    const { data } = await esiPostPublic<Array<{ id: number; name: string; category: string }>>(`/universe/names/`, chunk);
    await names.setNames('system', data
      .filter(d => d.category === 'solar_system')
      .map(d => ({ id: d.id, name: d.name })));
  }

  return names.countNames('system');
}

export interface SystemSearchHit {
  id: number;
  name: string;
}

export async function searchSystems(query: string, limit = 3): Promise<SystemSearchHit[]> {
  return cache().searchNames('system', query, limit);
}

export async function resolveType(id: number): Promise<string> {
  const hit = await cached('type', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/types/${id}/`);
  await store('type', id, data.name);
  return data.name;
}

export async function resolveSchematic(id: number): Promise<string> {
  const hit = await cached('schematic', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ schematic_name: string }>(`/universe/schematics/${id}/`);
  await store('schematic', id, data.schematic_name);
  return data.schematic_name;
}

export interface SystemInfoPublic {
  system_id: number;
  name: string;
  security_status: number;
  constellation_id: number;
  planets?: Array<{ planet_id: number; asteroid_belts?: number[]; moons?: number[] }>;
}

export async function getSystemInfo(id: number): Promise<SystemInfoPublic> {
  const { data } = await esiGetPublic<SystemInfoPublic>(`/universe/systems/${id}/`);
  await store('system', id, data.name);
  return data;
}

export interface PlanetPublic {
  planet_id: number;
  name: string;
  system_id: number;
  type_id: number;
  position: { x: number; y: number; z: number };
}

export async function getPlanetPublic(id: number): Promise<PlanetPublic> {
  // Cache the planet's display name under a 'planet' category so repeated lookups stay cheap.
  const cachedName = await cached('planet', id);
  const { data } = await esiGetPublic<PlanetPublic>(`/universe/planets/${id}/`);
  if (!cachedName) await store('planet', id, data.name);
  return data;
}

export async function resolveStation(id: number): Promise<string> {
  const hit = await cached('station', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/stations/${id}/`);
  await store('station', id, data.name);
  return data.name;
}

// Structures (player-owned citadels) are private: the name only resolves for a character
// with esi-universe.read_structures.v1 AND docking/grid access to that structure. ESI returns
// the citadel's own name (by player convention usually system-prefixed, e.g. "J155720 - Home").
// Names are cached per process and per character so access-derived names do not become global.
// Returns null when the structure can't be resolved (no scope, no access, or transient error) so
// the caller can fall back to the system/wormhole label it already has.
export async function resolveStructure(id: number, characterId: number): Promise<string | null> {
  const cacheKey = `${characterId}:${id}`;
  const hit = privateStructureNames.get(cacheKey);
  if (hit) return hit;
  try {
    const { data } = await esiGet<{ name: string }>(`/universe/structures/${id}/`, characterId);
    if (data?.name) {
      privateStructureNames.set(cacheKey, data.name);
      return data.name;
    }
    return null;
  } catch {
    // 401 (token predates scope), 403 (no docking access), or transient ESI error — fall back.
    return null;
  }
}

export interface CharacterPublic {
  name: string;
  corporation_id: number;
  alliance_id?: number;
}

export async function getCharacterPublic(id: number): Promise<CharacterPublic> {
  const { data } = await esiGetPublic<CharacterPublic>(`/characters/${id}/`);
  return data;
}

export type { CorporationInfo } from './universe-cache-store.ts';

export async function resolveCorporation(id: number): Promise<CorporationInfo> {
  const row = await cache().getCorporation(id);
  if (row) return row;
  const { data } = await esiGetPublic<CorporationInfo & { name: string; ticker: string }>(`/corporations/${id}/`);
  await cache().setCorporation(id, data);
  return { name: data.name, ticker: data.ticker };
}
