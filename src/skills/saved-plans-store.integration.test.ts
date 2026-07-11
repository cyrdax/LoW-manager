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
import { createPostgresSavedSkillPlanStore } from './saved-plans-store.ts';

const config = postgresTestConfig();

test('PostgresSavedSkillPlanStore persists saved skill plans', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'saved_skill_plans');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const users = await Promise.all([
      createUserWithCharacter(pool, 'alpha@example.com', 101, 'Alpha'),
      createUserWithCharacter(pool, 'beta@example.com', 202, 'Beta'),
    ]);
    let now = new Date('2026-07-11T12:00:00Z');
    const store = createPostgresSavedSkillPlanStore(pool, { now: () => now });

    const saved = await store.save({
      userId: users[0].id,
      characterId: 101,
      shipId: 19720,
      masteryLevel: 4,
      label: 'Main dread',
    });
    await store.save({
      userId: users[1].id,
      characterId: 202,
      shipId: 23757,
      masteryLevel: 3,
      label: 'Carrier',
    });

    assert.deepEqual((await store.list(users[0].id)).map(row => row.id), [saved.id]);
    assert.deepEqual((await store.list(users[0].id, 101)).map(row => row.ship_id), [19720]);

    now = new Date('2026-07-11T13:00:00Z');
    const updated = await store.save({
      userId: users[0].id,
      characterId: 101,
      shipId: 19720,
      masteryLevel: 4,
      label: 'Updated',
    });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.saved_at, now.getTime());
    assert.equal(await store.delete(users[1].id, saved.id), false);
    assert.equal(await store.delete(users[0].id, saved.id), true);
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});

async function createUserWithCharacter(
  pool: { query<T>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }> },
  email: string,
  characterId: number,
  characterName: string,
): Promise<{ id: string }> {
  const user = await pool.query<{ id: string }>(
    `
      INSERT INTO app_users (email, email_verified_at)
      VALUES ($1, now())
      RETURNING id
    `,
    [email],
  );
  await pool.query(
    `
      INSERT INTO characters (
        character_id, user_id, character_name, owner_hash, scopes, refresh_token_enc
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      characterId,
      user.rows[0].id,
      characterName,
      `owner-${characterId}`,
      'esi-skills.read_skills.v1',
      JSON.stringify({ iv: 'iv', ciphertext: 'ciphertext', tag: 'tag' }),
    ],
  );
  return user.rows[0];
}
