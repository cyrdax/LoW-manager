import { getPostgresPool } from '../db/postgres.ts';
import type { QueryClient } from '../db/migrations.ts';

export interface UniverseName {
  id: number;
  name: string;
}

export interface CorporationInfo {
  name: string;
  ticker: string;
}

export interface UniverseCacheStore {
  getName(category: string, id: number): Promise<string | null>;
  setName(category: string, id: number, name: string): Promise<void>;
  setNames(category: string, names: UniverseName[]): Promise<void>;
  countNames(category: string): Promise<number>;
  missingNameIds(category: string, ids: number[]): Promise<number[]>;
  searchNames(category: string, query: string, limit: number): Promise<UniverseName[]>;
  getCorporation(id: number): Promise<CorporationInfo | null>;
  setCorporation(id: number, info: CorporationInfo): Promise<void>;
}

export function createUniverseCacheStore(client: QueryClient = getPostgresPool()): UniverseCacheStore {
  return {
    async getName(category, id) {
      const rows = await client.query<{ name: string }>(
        'SELECT name FROM universe_names WHERE category = $1 AND id = $2',
        [category, id],
      );
      return rows.rows[0]?.name ?? null;
    },

    async setName(category, id, name) {
      await client.query(
        `
          INSERT INTO universe_names (category, id, name)
          VALUES ($1, $2, $3)
          ON CONFLICT (category, id) DO UPDATE SET name = excluded.name
        `,
        [category, id, name],
      );
    },

    async setNames(category, names) {
      if (names.length === 0) return;
      await client.query(
        `
          INSERT INTO universe_names (category, id, name)
          SELECT $1, input.id, input.name
          FROM unnest($2::bigint[], $3::text[]) AS input(id, name)
          ON CONFLICT (category, id) DO UPDATE SET name = excluded.name
        `,
        [category, names.map(n => n.id), names.map(n => n.name)],
      );
    },

    async countNames(category) {
      const rows = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM universe_names WHERE category = $1',
        [category],
      );
      return rows.rows[0]?.count ?? 0;
    },

    async missingNameIds(category, ids) {
      if (ids.length === 0) return [];
      const rows = await client.query<{ id: string | number }>(
        `
          SELECT input.id
          FROM unnest($1::bigint[]) AS input(id)
          LEFT JOIN universe_names cache
            ON cache.category = $2 AND cache.id = input.id
          WHERE cache.id IS NULL
          ORDER BY input.id
        `,
        [ids, category],
      );
      return rows.rows.map(row => Number(row.id));
    },

    async searchNames(category, query, limit) {
      const q = query.trim();
      if (q.length < 2 || limit <= 0) return [];

      const prefix = await queryNames(category, `${escapeLike(q)}%`, limit);
      if (prefix.length >= limit) return prefix;

      const seen = new Set(prefix.map(row => row.id));
      const substr = await queryNames(category, `%${escapeLike(q)}%`, limit * 2);
      for (const row of substr) {
        if (seen.has(row.id)) continue;
        prefix.push(row);
        if (prefix.length >= limit) break;
      }
      return prefix;
    },

    async getCorporation(id) {
      const rows = await client.query<CorporationInfo>(
        'SELECT name, ticker FROM corporations WHERE id = $1',
        [id],
      );
      return rows.rows[0] ?? null;
    },

    async setCorporation(id, info) {
      await client.query(
        `
          INSERT INTO corporations (id, name, ticker)
          VALUES ($1, $2, $3)
          ON CONFLICT (id) DO UPDATE SET name = excluded.name, ticker = excluded.ticker
        `,
        [id, info.name, info.ticker],
      );
    },
  };

  async function queryNames(category: string, pattern: string, limit: number): Promise<UniverseName[]> {
    const rows = await client.query<{ id: string | number; name: string }>(
      `
        SELECT id, name FROM universe_names
        WHERE category = $1 AND name ILIKE $2 ESCAPE '\\'
        ORDER BY length(name) ASC, name ASC
        LIMIT $3
      `,
      [category, pattern, limit],
    );
    return rows.rows.map(row => ({ id: Number(row.id), name: row.name }));
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}
