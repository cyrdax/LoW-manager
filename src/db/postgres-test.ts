import { Pool } from 'pg';
import { createPostgresPool } from './postgres.ts';

export interface PostgresTestConfig {
  databaseUrl?: string;
  testDatabaseUrl?: string;
}

export function postgresTestConfig(env: NodeJS.ProcessEnv = process.env): Required<PostgresTestConfig> | null {
  const databaseUrl = env.DATABASE_URL;
  const testDatabaseUrl = env.TEST_DATABASE_URL;
  if (!databaseUrl || !testDatabaseUrl) return null;
  return { databaseUrl, testDatabaseUrl };
}

export async function resetPostgresTestDatabase(config: Required<PostgresTestConfig>): Promise<void> {
  const adminName = databaseName(config.databaseUrl);
  const testName = databaseName(config.testDatabaseUrl);
  if (!testName.includes('_test')) throw new Error('TEST_DATABASE_URL database name must include _test');
  if (testName === adminName) throw new Error('TEST_DATABASE_URL must not point at the main database');

  const adminPool = createPostgresPool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testName)} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(testName)}`);
  } finally {
    await adminPool.end();
  }
}

export async function dropPostgresTestDatabase(config: Required<PostgresTestConfig>): Promise<void> {
  const adminName = databaseName(config.databaseUrl);
  const testName = databaseName(config.testDatabaseUrl);
  if (!testName.includes('_test')) throw new Error('TEST_DATABASE_URL database name must include _test');
  if (testName === adminName) throw new Error('TEST_DATABASE_URL must not point at the main database');

  const adminPool = createPostgresPool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testName)} WITH (FORCE)`);
  } finally {
    await adminPool.end();
  }
}

export function isolatePostgresTestConfig(
  config: Required<PostgresTestConfig>,
  suffix: string,
): Required<PostgresTestConfig> {
  const url = new URL(config.testDatabaseUrl);
  const baseName = databaseName(config.testDatabaseUrl);
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  url.pathname = `/${baseName}_${safeSuffix}`;
  return { databaseUrl: config.databaseUrl, testDatabaseUrl: url.toString() };
}

export function createPostgresTestPool(config: Required<PostgresTestConfig>): Pool {
  return createPostgresPool({ connectionString: config.testDatabaseUrl, max: 2 });
}

export async function truncatePostgresTables(pool: Pool, options: { except?: string[] } = {}): Promise<void> {
  const except = new Set(options.except ?? ['schema_migrations']);
  const rows = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = rows.rows
    .map(row => row.table_name)
    .filter(table => !except.has(table));
  if (tables.length === 0) return;
  await pool.query(`TRUNCATE ${tables.map(quoteIdentifier).join(', ')} RESTART IDENTITY CASCADE`);
}

function databaseName(connectionString: string): string {
  const url = new URL(connectionString);
  const name = url.pathname.replace(/^\//, '');
  if (!name) throw new Error('Postgres connection string must include a database name');
  return decodeURIComponent(name);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
