import { getPostgresPool } from '../db/postgres.ts';
import type { QueryClient } from '../db/migrations.ts';

export interface SavedSystem {
  systemId: number;
  systemName: string;
  savedAt: number;
}

export interface SavedSystemsStore {
  list(): Promise<SavedSystem[]>;
  has(systemId: number): Promise<boolean>;
  add(systemId: number, systemName: string): Promise<void>;
  delete(systemId: number): Promise<void>;
}

export interface SavedSystemsStoreOptions {
  now?: () => Date;
}

interface SavedSystemRow {
  system_id: string | number;
  system_name: string;
  saved_at: Date | string | number;
}

export function createSavedSystemsStore(
  client: QueryClient = getPostgresPool(),
  options: SavedSystemsStoreOptions = {},
): SavedSystemsStore {
  const now = options.now ?? (() => new Date());

  return {
    async list() {
      const rows = await client.query<SavedSystemRow>(
        'SELECT system_id, system_name, saved_at FROM saved_systems ORDER BY system_name',
      );
      return rows.rows.map(row => ({
        systemId: Number(row.system_id),
        systemName: row.system_name,
        savedAt: toEpochMs(row.saved_at),
      }));
    },

    async has(systemId) {
      const rows = await client.query<{ system_id: string | number }>(
        'SELECT system_id FROM saved_systems WHERE system_id = $1',
        [systemId],
      );
      return rows.rows.length > 0;
    },

    async add(systemId, systemName) {
      await client.query(
        `
          INSERT INTO saved_systems (system_id, system_name, saved_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (system_id) DO NOTHING
        `,
        [systemId, systemName, now()],
      );
    },

    async delete(systemId) {
      await client.query('DELETE FROM saved_systems WHERE system_id = $1', [systemId]);
    },
  };
}

function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}
