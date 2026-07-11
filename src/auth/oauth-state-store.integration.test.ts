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
import { createOAuthStateStore, hashState } from './oauth-state-store.ts';

const config = postgresTestConfig();

test('OAuthStateStore persists and consumes EVE OAuth state in Postgres', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'oauth_state');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const store = createOAuthStateStore(pool, {
      now: () => new Date('2026-07-11T12:00:00Z'),
    });

    const state = await store.issue();
    const rows = await pool.query<{ purpose: string; token_hash: string; consumed_at: Date | null }>(
      'SELECT purpose, token_hash, consumed_at FROM auth_tokens',
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].purpose, 'eve_oauth_state');
    assert.equal(rows.rows[0].token_hash, hashState(state));
    assert.equal(rows.rows[0].consumed_at, null);

    assert.equal(await store.consume(state), true);
    assert.equal(await store.consume(state), false);
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});
