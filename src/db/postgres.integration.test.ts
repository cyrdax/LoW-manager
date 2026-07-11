import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from './migrations.ts';
import {
  createPostgresTestPool,
  dropPostgresTestDatabase,
  isolatePostgresTestConfig,
  postgresTestConfig,
  resetPostgresTestDatabase,
  truncatePostgresTables,
} from './postgres-test.ts';

const config = postgresTestConfig();

test('postgres migrations boot the live test schema', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'schema');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    const result = await runMigrations(pool);
    assert.deepEqual(result.applied, ['0001_multi_tenant_foundation']);

    const migrationCount = await pool.query<{ count: string }>('SELECT count(*) AS count FROM schema_migrations');
    assert.equal(Number(migrationCount.rows[0].count), 1);

    const tableCount = await pool.query<{ count: string }>(`
      SELECT count(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `);
    assert.equal(Number(tableCount.rows[0].count), 20);

    await truncatePostgresTables(pool);
    const userCount = await pool.query<{ count: string }>('SELECT count(*) AS count FROM app_users');
    assert.equal(Number(userCount.rows[0].count), 0);
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});
