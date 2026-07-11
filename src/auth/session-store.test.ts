import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStore, hashSessionToken } from './session-store.ts';
import type { QueryClient } from '../db/migrations.ts';

class FakeClient implements QueryClient {
  users = new Map<string, UserRow>();
  sessions = new Map<string, SessionRow>();
  nextSessionId = 1;

  constructor() {
    this.users.set('active-user', userRow('active-user', 'active'));
    this.users.set('disabled-user', userRow('disabled-user', 'disabled'));
  }

  async query<T>(text: string, params?: readonly unknown[]) {
    if (text.includes('INSERT INTO user_sessions')) {
      const user = this.users.get(String(params?.[0]));
      if (!user || user.status !== 'active') return { rows: [], rowCount: 0 } as T;
      const row: SessionRow = {
        id: `session-${this.nextSessionId++}`,
        user_id: user.id,
        token_hash: String(params?.[1]),
        created_at: params?.[2] as Date,
        expires_at: params?.[3] as Date,
        revoked_at: null,
        last_seen_at: null,
        ip_hash: params?.[4] as string | null,
        user_agent_hash: params?.[5] as string | null,
      };
      this.sessions.set(row.token_hash, row);
      return { rows: [row], rowCount: 1 } as T;
    }
    if (text.includes('JOIN app_users')) {
      const row = this.sessions.get(String(params?.[0]));
      const now = params?.[1] as Date;
      const user = row ? this.users.get(row.user_id) : undefined;
      const valid = row && user?.status === 'active' && row.revoked_at == null && row.expires_at > now;
      return {
        rows: valid ? [{ ...row, user_email: user.email, user_role: user.role, user_status: user.status }] : [],
        rowCount: valid ? 1 : 0,
      } as T;
    }
    if (text.includes('UPDATE user_sessions') && text.includes('last_seen_at')) {
      const row = Array.from(this.sessions.values()).find(session => session.id === params?.[0]);
      if (row) row.last_seen_at = params?.[1] as Date;
      return { rows: [], rowCount: row ? 1 : 0 } as T;
    }
    if (text.includes('UPDATE user_sessions') && text.includes('SET revoked_at')) {
      const row = this.sessions.get(String(params?.[0]));
      if (row && row.revoked_at == null) row.revoked_at = params?.[1] as Date;
      return { rows: [], rowCount: row ? 1 : 0 } as T;
    }
    if (text.includes('DELETE FROM user_sessions')) {
      return { rows: [], rowCount: 2 } as T;
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

test('hashSessionToken hashes raw session tokens', () => {
  const token = 'session-token';
  const hash = hashSessionToken(token);
  assert.notEqual(hash, token);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('SessionStore creates hashed sessions only for active users', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const store = createSessionStore(client, {
    now: () => now,
    tokenFactory: () => 'raw-session-token',
    ttlMs: 60_000,
  });

  const issued = await store.create('active-user', { ipHash: 'ip', userAgentHash: 'ua' });
  assert.equal(issued?.token, 'raw-session-token');
  assert.equal(issued?.session.tokenHash, hashSessionToken('raw-session-token'));
  assert.equal(issued?.session.expiresAt.toISOString(), '2026-07-11T12:01:00.000Z');
  assert.equal(await store.create('disabled-user'), null);
});

test('SessionStore finds, touches, revokes, and expires sessions by raw token', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const store = createSessionStore(client, {
    now: () => now,
    tokenFactory: () => 'raw-session-token',
    ttlMs: 60_000,
  });

  const issued = await store.create('active-user');
  assert.ok(issued);

  const found = await store.findByToken('raw-session-token');
  assert.equal(found?.session.id, issued.session.id);
  assert.equal(found?.user.id, 'active-user');

  await store.touch(issued.session.id);
  assert.equal(client.sessions.get(hashSessionToken('raw-session-token'))?.last_seen_at?.toISOString(), now.toISOString());

  await store.revoke('raw-session-token');
  assert.equal(await store.findByToken('raw-session-token'), null);
  assert.equal(await store.deleteExpired(), 2);
});

interface UserRow {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled' | 'deleted';
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date | null;
  ip_hash: string | null;
  user_agent_hash: string | null;
}

function userRow(id: string, status: UserRow['status']): UserRow {
  return {
    id,
    email: `${id}@example.com`,
    role: id === 'active-user' ? 'admin' : 'user',
    status,
  };
}
