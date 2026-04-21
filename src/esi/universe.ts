import { db } from '../db.ts';
import { esiGetPublic, esiPostPublic } from './client.ts';

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

export async function resolveStation(id: number): Promise<string> {
  const hit = cached('station', id);
  if (hit) return hit;
  const { data } = await esiGetPublic<{ name: string }>(`/universe/stations/${id}/`);
  store('station', id, data.name);
  return data.name;
}

// Structures (player-owned) require an authed character with esi-universe.read_structures.v1.
// We don't request that scope, so we just show the ID. This keeps the scope list minimal.
export async function resolveStructure(id: number, _characterId: number): Promise<string> {
  return `Structure ${id}`;
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
