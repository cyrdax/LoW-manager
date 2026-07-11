import type { QueryClient, QueryPool } from './migrations.ts';

export type TransactionSource = QueryClient & Partial<QueryPool>;

export async function withTransaction<T>(
  source: TransactionSource,
  fn: (client: QueryClient) => Promise<T>,
): Promise<T> {
  if (hasConnect(source)) {
    const client = await source.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  await source.query('BEGIN');
  try {
    const result = await fn(source);
    await source.query('COMMIT');
    return result;
  } catch (err) {
    await source.query('ROLLBACK');
    throw err;
  }
}

function hasConnect(source: TransactionSource): source is TransactionSource & QueryPool {
  return typeof (source as QueryPool).connect === 'function';
}
