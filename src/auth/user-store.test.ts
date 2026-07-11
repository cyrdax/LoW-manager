import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserStore, normalizeEmail } from './user-store.ts';
import type { QueryClient } from '../db/migrations.ts';

class FakeClient implements QueryClient {
  users = new Map<string, UserRow>();
  credentials = new Map<string, { user_id: string; email: string; password_hash: string }>();
  googleAccounts = new Map<string, { google_sub: string; user_id: string; email: string; email_verified: boolean }>();
  adminCount = 0;
  nextId = 1;
  inTransaction = false;

  async query<T>(text: string, params?: readonly unknown[]) {
    if (text === 'BEGIN') {
      this.inTransaction = true;
      return { rows: [], rowCount: 0 } as T;
    }
    if (text === 'COMMIT' || text === 'ROLLBACK') {
      this.inTransaction = false;
      return { rows: [], rowCount: 0 } as T;
    }
    if (text.includes('SELECT CASE') && text.includes('FROM app_users')) {
      return { rows: [{ role: this.adminCount > 0 ? 'user' : 'admin' }], rowCount: 1 } as T;
    }
    if (text.includes('FROM user_google_accounts')) {
      const account = this.googleAccounts.get(String(params?.[0]));
      const user = account ? this.users.get(account.user_id) : undefined;
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 } as T;
    }
    if (text.includes('FROM app_users') && text.includes('WHERE email')) {
      const user = Array.from(this.users.values()).find(row => row.email === params?.[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 } as T;
    }
    if (text.includes('INSERT INTO app_users')) {
      const isGoogleUser = text.includes('INSERT INTO app_users (email, email_verified_at');
      const role = (isGoogleUser ? params?.[2] : params?.[1]) as 'user' | 'admin';
      const timestamp = (isGoogleUser ? params?.[3] : params?.[2]) as Date;
      const row: UserRow = {
        id: `user-${this.nextId++}`,
        email: String(params?.[0]),
        email_verified_at: isGoogleUser ? params?.[1] as Date | null : null,
        role,
        status: 'active',
        main_character_id: null,
        last_active_at: null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      };
      if (row.role === 'admin') this.adminCount += 1;
      this.users.set(row.id, row);
      return { rows: [row], rowCount: 1 } as T;
    }
    if (text.includes('INSERT INTO user_password_credentials')) {
      this.credentials.set(String(params?.[1]), {
        user_id: String(params?.[0]),
        email: String(params?.[1]),
        password_hash: String(params?.[2]),
      });
      return { rows: [], rowCount: 1 } as T;
    }
    if (text.includes('INSERT INTO user_google_accounts')) {
      this.googleAccounts.set(String(params?.[0]), {
        google_sub: String(params?.[0]),
        user_id: String(params?.[1]),
        email: String(params?.[2]),
        email_verified: Boolean(params?.[3]),
      });
      return { rows: [], rowCount: 1 } as T;
    }
    if (text.includes('JOIN user_password_credentials')) {
      const credential = this.credentials.get(String(params?.[0]));
      const user = credential ? this.users.get(credential.user_id) : undefined;
      return {
        rows: user ? [{ ...user, password_hash: credential?.password_hash }] : [],
        rowCount: user ? 1 : 0,
      } as T;
    }
    if (text.includes('UPDATE app_users') && text.includes('SET email_verified_at')) {
      const user = this.users.get(String(params?.[0]));
      if (!user) return { rows: [], rowCount: 0 } as T;
      user.email_verified_at = params?.[1] as Date;
      user.updated_at = params?.[1] as Date;
      return { rows: [user], rowCount: 1 } as T;
    }
    if (text.includes('UPDATE app_users') && text.includes('SET last_active_at')) {
      const user = this.users.get(String(params?.[0]));
      if (!user || user.status !== 'active') return { rows: [], rowCount: 0 } as T;
      user.last_active_at = params?.[1] as Date;
      user.updated_at = params?.[1] as Date;
      return { rows: [user], rowCount: 1 } as T;
    }
    if (text.includes('UPDATE user_password_credentials')) {
      const credential = Array.from(this.credentials.values()).find(c => c.user_id === params?.[0]);
      if (!credential) return { rows: [], rowCount: 0 } as T;
      credential.password_hash = String(params?.[1]);
      return { rows: [{ user_id: credential.user_id }], rowCount: 1 } as T;
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

test('normalizeEmail trims and lowercases account emails', () => {
  assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
});

test('UserStore creates password users and makes the first user admin', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const store = createUserStore(client, { now: () => now });

  const first = await store.createPasswordUser(' Owner@Example.COM ', 'hash-one');
  const second = await store.createPasswordUser('Pilot@Example.com', 'hash-two');

  assert.equal(client.inTransaction, false);
  assert.equal(first.email, 'owner@example.com');
  assert.equal(first.role, 'admin');
  assert.equal(second.role, 'user');
});

test('UserStore finds password users by normalized email and verifies email', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const later = new Date('2026-07-11T13:00:00Z');
  const store = createUserStore(client, { now: () => now });

  const user = await store.createPasswordUser('Pilot@Example.com', 'password-hash');
  const found = await store.findByEmailWithPassword(' pilot@example.COM ');

  assert.equal(found?.user.id, user.id);
  assert.equal(found?.passwordHash, 'password-hash');
  assert.equal(found?.user.emailVerifiedAt, null);

  const verified = await createUserStore(client, { now: () => later }).markEmailVerified(user.id);
  assert.equal(verified?.emailVerifiedAt?.toISOString(), later.toISOString());

  const active = await createUserStore(client, { now: () => later }).markActive(user.id);
  assert.equal(active?.lastActiveAt?.toISOString(), later.toISOString());
});

test('UserStore updates password credentials for active users', async () => {
  const client = new FakeClient();
  const store = createUserStore(client);
  const user = await store.createPasswordUser('pilot@example.com', 'old-hash');

  assert.equal(await store.updatePassword(user.id, 'new-hash'), true);
  assert.equal((await store.findByEmailWithPassword('pilot@example.com'))?.passwordHash, 'new-hash');
  assert.equal(await store.updatePassword('missing-user', 'newer-hash'), false);
});

test('UserStore links Google accounts and reuses existing users by email', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const store = createUserStore(client, { now: () => now });

  const passwordUser = await store.createPasswordUser('Pilot@Example.com', 'hash');
  const linked = await store.findOrCreateGoogleUser({
    googleSub: 'google-sub-1',
    email: ' pilot@example.COM ',
    emailVerified: true,
  });
  const sameGoogle = await store.findOrCreateGoogleUser({
    googleSub: 'google-sub-1',
    email: 'pilot@example.com',
    emailVerified: true,
  });
  const newGoogle = await store.findOrCreateGoogleUser({
    googleSub: 'google-sub-2',
    email: 'new@example.com',
    emailVerified: true,
  });

  assert.equal(linked.id, passwordUser.id);
  assert.equal(sameGoogle.id, passwordUser.id);
  assert.equal(linked.emailVerifiedAt?.toISOString(), now.toISOString());
  assert.equal(newGoogle.email, 'new@example.com');
  assert.equal(newGoogle.role, 'user');
});

interface UserRow {
  id: string;
  email: string;
  email_verified_at: Date | null;
  role: 'user' | 'admin';
  status: 'active' | 'disabled' | 'deleted';
  main_character_id: number | null;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}
