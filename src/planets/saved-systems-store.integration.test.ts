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
import { createSavedSystemsStore } from './saved-systems-store.ts';

const config = postgresTestConfig();

test('SavedSystemsStore persists PI saved systems in Postgres', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'saved_systems');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const now = new Date('2026-07-11T12:00:00Z');
    const store = createSavedSystemsStore(pool, { now: () => now });

    await store.add(30_000_142, 'Jita');
    await store.add(30_002_187, 'Amarr');

    assert.equal(await store.has(30_000_142), true);
    assert.deepEqual(await store.list(), [
      { systemId: 30_002_187, systemName: 'Amarr', savedAt: now.getTime() },
      { systemId: 30_000_142, systemName: 'Jita', savedAt: now.getTime() },
    ]);

    await store.delete(30_000_142);
    assert.equal(await store.has(30_000_142), false);
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});
