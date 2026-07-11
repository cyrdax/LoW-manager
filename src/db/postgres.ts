import { Pool, type PoolConfig } from 'pg';

let appPool: Pool | null = null;

export interface PostgresPoolOptions {
  connectionString?: string;
  max?: number;
  ssl?: boolean;
}

export function postgresConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('Missing env DATABASE_URL');
  return url;
}

export function createPostgresPool(options: PostgresPoolOptions = {}, env: NodeJS.ProcessEnv = process.env): Pool {
  const ssl = options.ssl ?? parseBoolean(env.DATABASE_SSL);
  const config: PoolConfig = {
    connectionString: options.connectionString ?? postgresConnectionString(env),
    max: options.max ?? Number(env.DATABASE_POOL_MAX ?? 10),
  };
  if (ssl) {
    config.ssl = {
      rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }
  return new Pool(config);
}

export function getPostgresPool(): Pool {
  if (!appPool) appPool = createPostgresPool();
  return appPool;
}

export async function closePostgresPool(): Promise<void> {
  if (!appPool) return;
  const pool = appPool;
  appPool = null;
  await pool.end();
}

function parseBoolean(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}
