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
import { createPostgresFitStore } from './store.ts';

const config = postgresTestConfig();

test('PostgresFitStore persists private and public saved fits', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'saved_fits');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const owner = await createUser(pool, 'owner@example.com');
    const other = await createUser(pool, 'other@example.com');
    let now = new Date('2026-07-11T12:00:00Z');
    const store = createPostgresFitStore(pool, { now: () => now });

    const saved = await store.create({
      ownerUserId: owner.id,
      visibility: 'private',
      rawEft: '[Naglfar, Test Fit]\nRepublic Fleet Gyrostabilizer',
      notes: 'First',
    });
    assert.equal(saved.ownerUserId, owner.id);
    assert.equal(saved.ship?.name, 'Naglfar');
    assert.equal(saved.items.length, 1);
    assert.deepEqual((await store.list({ visibility: 'private', ownerUserId: owner.id })).map(row => row.id), [saved.id]);

    now = new Date('2026-07-11T13:00:00Z');
    const updated = await store.update(saved.id, {
      fitName: 'Updated Fit',
      notes: 'Updated notes',
    });
    assert.equal(updated?.fitName, 'Updated Fit');
    assert.equal(updated?.updatedAt, now.getTime());

    const published = await store.publish(saved.id);
    assert.equal(published?.visibility, 'public');
    const copied = await store.copyToPrivate(saved.id, other.id);
    assert.equal(copied?.ownerUserId, other.id);
    assert.equal(copied?.sourcePublicFitId, saved.id);

    assert.equal(await store.delete(saved.id), true);
    assert.equal(await store.get(saved.id), null);
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});

async function createUser(
  pool: { query<T>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }> },
  email: string,
): Promise<{ id: string }> {
  const user = await pool.query<{ id: string }>(
    `
      INSERT INTO app_users (email, email_verified_at)
      VALUES ($1, now())
      RETURNING id
    `,
    [email],
  );
  return user.rows[0];
}
