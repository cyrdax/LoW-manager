import { db } from '../db.ts';
import { esiGet, esiGetPublic, esiPostPublic } from './client.ts';

function cached(category: string, id: number): string | null {
  const row = db.prepare('SELECT name FROM universe_names WHERE category = ? AND id = ?').get(category, id) as { name: string } | undefined;
  return row?.name ?? null;
}

function store(category: string, id: number, name: string) {
  db.prepare('INSERT OR REPLACE INTO universe_names (category, id, name) VALUES (?, ?, ?)').run(category, id, name);
}

export async function resolveSystem(id: number): Promise<string> {
  const hit = cached('system', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/systems/${id}/`);
  store('system', id, data.name);
  return data.name;
}

/**
 * Bulk-fetch all solar system IDs and resolve their names, seeding the universe_names cache.
 * Idempotent; cheap after first run because subsequent runs see the cache is already populated.
 */
export async function bootstrapSystemsCache(): Promise<number> {
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM universe_names WHERE category = 'system'`).get() as { c: number };
  if (existing.c > 7000) return existing.c; // New Eden has ~8k+ K-space + W-space systems; skip if we clearly have them

  const { data: ids } = await esiGetPublic<number[]>(`/universe/systems/`);
  const missing = ids.filter(id => !cached('system', id));

  const insert = db.prepare(`INSERT OR REPLACE INTO universe_names (category, id, name) VALUES ('system', ?, ?)`);
  const tx = db.transaction((rows: Array<{ id: number; name: string }>) => {
    for (const r of rows) insert.run(r.id, r.name);
  });

  // /universe/names/ accepts up to 1000 IDs per call
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    const { data } = await esiPostPublic<Array<{ id: number; name: string; category: string }>>(`/universe/names/`, chunk);
    tx(data.filter(d => d.category === 'solar_system'));
  }

  const final = db.prepare(`SELECT COUNT(*) AS c FROM universe_names WHERE category = 'system'`).get() as { c: number };
  return final.c;
}

export interface SystemSearchHit {
  id: number;
  name: string;
}

export function searchSystems(query: string, limit = 3): SystemSearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  // Prefix match first (more relevant), then substring — de-duplicated, ordered by name length.
  const prefix = db.prepare(`
    SELECT id, name FROM universe_names
    WHERE category = 'system' AND name LIKE ? COLLATE NOCASE
    ORDER BY length(name) ASC
    LIMIT ?
  `).all(`${q}%`, limit) as SystemSearchHit[];

  if (prefix.length >= limit) return prefix;

  const seen = new Set(prefix.map(p => p.id));
  const substr = db.prepare(`
    SELECT id, name FROM universe_names
    WHERE category = 'system' AND name LIKE ? COLLATE NOCASE
    ORDER BY length(name) ASC
    LIMIT ?
  `).all(`%${q}%`, limit * 2) as SystemSearchHit[];

  for (const s of substr) {
    if (seen.has(s.id)) continue;
    prefix.push(s);
    if (prefix.length >= limit) break;
  }
  return prefix;
}

export async function resolveType(id: number): Promise<string> {
  const hit = cached('type', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/types/${id}/`);
  store('type', id, data.name);
  return data.name;
}

export async function resolveSchematic(id: number): Promise<string> {
  const hit = cached('schematic', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ schematic_name: string }>(`/universe/schematics/${id}/`);
  store('schematic', id, data.schematic_name);
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
  store('system', id, data.name);
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
  const cachedName = cached('planet', id);
  const { data } = await esiGetPublic<PlanetPublic>(`/universe/planets/${id}/`);
  if (!cachedName) store('planet', id, data.name);
  return data;
}

export async function resolveStation(id: number): Promise<string> {
  const hit = cached('station', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/stations/${id}/`);
  store('station', id, data.name);
  return data.name;
}

// Structures (player-owned citadels) are private: the name only resolves for a character
// with esi-universe.read_structures.v1 AND docking/grid access to that structure. ESI returns
// the citadel's own name (by player convention usually system-prefixed, e.g. "J155720 - Home").
// Names are cached permanently — they rarely change and a 403 elsewhere shouldn't lose a known one.
// Returns null when the structure can't be resolved (no scope, no access, or transient error) so
// the caller can fall back to the system/wormhole label it already has.
export async function resolveStructure(id: number, characterId: number): Promise<string | null> {
  const hit = cached('structure', id);
  if (hit) return hit;
  try {
    const { data } = await esiGet<{ name: string }>(`/universe/structures/${id}/`, characterId);
    if (data?.name) {
      store('structure', id, data.name);
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

export interface CorporationInfo { name: string; ticker: string }

export async function resolveCorporation(id: number): Promise<CorporationInfo> {
  const row = db.prepare('SELECT name, ticker FROM corporations WHERE id = ?').get(id) as CorporationInfo | undefined;
  if (row) return row;
  const { data } = await esiGetPublic<CorporationInfo & { name: string; ticker: string }>(`/corporations/${id}/`);
  db.prepare('INSERT OR REPLACE INTO corporations (id, name, ticker) VALUES (?, ?, ?)').run(id, data.name, data.ticker);
  return { name: data.name, ticker: data.ticker };
}
