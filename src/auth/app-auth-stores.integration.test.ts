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
import { createAppTokenStore, hashAppToken } from './app-token-store.ts';
import { createSessionStore, hashSessionToken } from './session-store.ts';
import { createUserStore } from './user-store.ts';

const config = postgresTestConfig();

test('app auth stores persist users sessions and app tokens in Postgres', { skip: config ? false : 'DATABASE_URL and TEST_DATABASE_URL are required' }, async () => {
  assert.ok(config);
  const isolated = isolatePostgresTestConfig(config, 'app_auth_stores');
  await resetPostgresTestDatabase(isolated);
  const pool = createPostgresTestPool(isolated);
  try {
    await runMigrations(pool);
    const now = new Date('2026-07-11T12:00:00Z');
    const later = new Date('2026-07-11T12:00:30Z');
    const users = createUserStore(pool, { now: () => now });
    const sessions = createSessionStore(pool, {
      now: () => now,
      tokenFactory: () => 'raw-session-token',
      ttlMs: 30 * 60_000,
    });
    const appTokens = createAppTokenStore(pool, {
      now: () => now,
      tokenFactory: () => 'raw-email-token',
    });

    const first = await users.createPasswordUser(' Owner@Example.COM ', 'password-hash');
    const second = await users.createPasswordUser('pilot@example.com', 'password-hash-two');
    assert.equal(first.role, 'admin');
    assert.equal(second.role, 'user');

    const linkedGoogle = await users.findOrCreateGoogleUser({
      googleSub: 'google-owner-sub',
      email: 'owner@example.com',
      emailVerified: true,
    });
    const newGoogle = await users.findOrCreateGoogleUser({
      googleSub: 'google-new-sub',
      email: 'google-pilot@example.com',
      emailVerified: true,
    });
    const sameGoogle = await users.findOrCreateGoogleUser({
      googleSub: 'google-new-sub',
      email: 'google-pilot@example.com',
      emailVerified: true,
    });
    assert.equal(linkedGoogle.id, first.id);
    assert.equal(linkedGoogle.emailVerifiedAt?.toISOString(), now.toISOString());
    assert.equal(newGoogle.role, 'user');
    assert.equal(sameGoogle.id, newGoogle.id);

    const found = await users.findByEmailWithPassword('owner@example.com');
    assert.equal(found?.user.id, first.id);
    assert.equal(found?.passwordHash, 'password-hash');
    assert.equal((await users.markEmailVerified(first.id))?.emailVerifiedAt?.toISOString(), now.toISOString());
    assert.equal(await users.updatePassword(first.id, 'updated-password-hash'), true);
    assert.equal((await users.findByEmailWithPassword('owner@example.com'))?.passwordHash, 'updated-password-hash');

    const issuedSession = await sessions.create(first.id, { ipHash: 'ip-hash' });
    assert.equal(issuedSession?.token, 'raw-session-token');
    const sessionRows = await pool.query<{ token_hash: string }>('SELECT token_hash FROM user_sessions');
    assert.equal(sessionRows.rows[0].token_hash, hashSessionToken('raw-session-token'));
    assert.equal((await sessions.findByToken('raw-session-token'))?.user.id, first.id);

    const verificationToken = await appTokens.issue({
      userId: first.id,
      purpose: 'email_verification',
      metadata: { email: first.email },
      ttlMs: 60_000,
    });
    const tokenRows = await pool.query<{ token_hash: string }>('SELECT token_hash FROM auth_tokens WHERE purpose = $1', ['email_verification']);
    assert.equal(tokenRows.rows[0].token_hash, hashAppToken(verificationToken));

    const consumed = await createAppTokenStore(pool, { now: () => later }).consume('email_verification', verificationToken);
    assert.equal(consumed?.userId, first.id);
    assert.deepEqual(consumed?.metadata, { email: first.email });
  } finally {
    await pool.end();
    await dropPostgresTestDatabase(isolated);
  }
});
