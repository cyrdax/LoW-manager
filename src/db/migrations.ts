import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { getPostgresPool } from './postgres.ts';

export interface Migration {
  id: string;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface QueryClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface ReleasableQueryClient extends QueryClient {
  release(): void;
}

export interface QueryPool {
  connect(): Promise<ReleasableQueryClient>;
}

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export function readMigrations(dir = defaultMigrationsDir()): Migration[] {
  return readdirSync(dir)
    .filter(file => extname(file) === '.sql')
    .sort((a, b) => a.localeCompare(b))
    .map(file => {
      const sql = readFileSync(join(dir, file), 'utf8').trim();
      return {
        id: file.replace(/\.sql$/, ''),
        name: file,
        checksum: checksum(sql),
        sql,
      };
    });
}

export async function runMigrations(
  pool: QueryPool | Pool = getPostgresPool(),
  options: { dir?: string } = {},
): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    return await runMigrationsWithClient(client, readMigrations(options.dir));
  } finally {
    client.release();
  }
}

export async function runMigrationsWithClient(
  client: QueryClient,
  migrations: Migration[],
): Promise<MigrationResult> {
  await client.query(MIGRATION_TABLE_SQL);
  const appliedRows = await client.query<{ id: string; checksum: string }>('SELECT id, checksum FROM schema_migrations ORDER BY id');
  const applied = new Map(appliedRows.rows.map(row => [row.id, row.checksum]));
  const result: MigrationResult = { applied: [], skipped: [] };

  await client.query('BEGIN');
  try {
    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.id);
      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Migration checksum changed for ${migration.id}`);
        }
        result.skipped.push(migration.id);
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)',
        [migration.id, migration.name, migration.checksum],
      );
      result.applied.push(migration.id);
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
