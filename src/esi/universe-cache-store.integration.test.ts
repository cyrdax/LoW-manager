import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrations.ts';
import {
  createPostgresTestPool,
  dropPostgresTestDatabase,
  isolatePostgresTestConfig,
  postgresTestConfig,
  resetPostgresTestDatabase,
} from '../db/postgres-test.ts';
import { createUniverseCacheStore } from './universe-cache-store.ts';

const config = postgresTestConfig();

test('UniverseCacheStore persists global cache rows in Postgres', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'universe_cache');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const store = createUniverseCacheStore(pool);

    await store.setNames('system', [
      { id: 30000142, name: 'Jita' },
      { id: 30002187, name: 'Amarr' },
      { id: 30_000_001, name: 'Jita Test Range' },
      { id: 30_000_002, name: 'Perjita' },
    ]);
    await store.setCorporation(98_434_315, { name: 'Deepwater Hooligans', ticker: 'BIGAB' });

    assert.equal(await store.getName('system', 30000142), 'Jita');
    assert.equal(await store.countNames('system'), 4);
    assert.deepEqual(await store.missingNameIds('system', [30000142, 30_000_003]), [30_000_003]);
    assert.deepEqual(await store.searchNames('system', 'ji', 3), [
      { id: 30000142, name: 'Jita' },
      { id: 30_000_001, name: 'Jita Test Range' },
      { id: 30_000_002, name: 'Perjita' },
    ]);
    assert.deepEqual(await store.getCorporation(98_434_315), { name: 'Deepwater Hooligans', ticker: 'BIGAB' });
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});
