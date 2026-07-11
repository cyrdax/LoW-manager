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
import { createPostgresDoctrineStore } from './doctrines.ts';
import { createPostgresFitStore } from './store.ts';

const config = postgresTestConfig();

test('PostgresDoctrineStore persists doctrines and member fits', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'doctrines');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const owner = await createUser(pool, 'owner@example.com');
    const other = await createUser(pool, 'other@example.com');
    let now = new Date('2026-07-11T12:00:00Z');
    const fits = createPostgresFitStore(pool, { now: () => now });
    const doctrines = createPostgresDoctrineStore(pool, { now: () => now, fitStore: fits });

    const privateFit = await fits.create({
      ownerUserId: owner.id,
      rawEft: '[Naglfar, Test Dread]\nRepublic Fleet Gyrostabilizer',
    });
    const publicFit = await fits.publish(privateFit.id);
    assert.ok(publicFit);

    const doctrine = await doctrines.create({
      name: 'Armor Dread Bomb',
      description: 'Escalation comp',
      ownerUserId: owner.id,
      visibility: 'private',
    });
    const withFit = await doctrines.addFit(doctrine.id, publicFit.id);
    assert.equal(withFit?.fitCount, 1);
    assert.deepEqual((await doctrines.list({ q: 'naglfar', visibility: 'private', ownerUserId: owner.id })).map(row => row.id), [doctrine.id]);

    now = new Date('2026-07-11T13:00:00Z');
    const published = await doctrines.publish(doctrine.id);
    assert.equal(published?.visibility, 'public');
    assert.equal(published?.updatedAt, now.getTime());

    const copied = await doctrines.copyToPrivate(doctrine.id, other.id);
    assert.equal(copied?.ownerUserId, other.id);
    assert.equal(copied?.sourcePublicDoctrineId, doctrine.id);
    assert.equal(copied?.fitCount, 1);
    assert.equal(copied?.fits[0].ownerUserId, other.id);

    assert.equal(await doctrines.delete(doctrine.id), true);
    assert.equal(await doctrines.get(doctrine.id), null);
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
