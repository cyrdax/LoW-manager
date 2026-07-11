import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppTokenStore, hashAppToken } from './app-token-store.ts';
import type { QueryClient } from '../db/migrations.ts';

class FakeClient implements QueryClient {
  tokens = new Map<string, TokenRow>();
  nextId = 1;

  async query<T>(text: string, params?: readonly unknown[]) {
    if (text.includes('INSERT INTO auth_tokens')) {
      const row: TokenRow = {
        id: `token-${this.nextId++}`,
        user_id: params?.[0] == null ? null : String(params?.[0]),
        purpose: String(params?.[1]),
        token_hash: String(params?.[2]),
        metadata: JSON.parse(String(params?.[3])),
        created_at: params?.[4] as Date,
        expires_at: params?.[5] as Date,
        consumed_at: null,
      };
      this.tokens.set(row.token_hash, row);
      return { rows: [], rowCount: 1 } as T;
    }
    if (text.includes('UPDATE auth_tokens')) {
      const row = this.tokens.get(String(params?.[1]));
      const now = params?.[2] as Date;
      const valid = row && row.purpose === params?.[0] && row.consumed_at == null && row.expires_at > now;
      if (!valid) return { rows: [], rowCount: 0 } as T;
      row.consumed_at = now;
      return { rows: [row], rowCount: 1 } as T;
    }
    if (text.includes('DELETE FROM auth_tokens')) {
      return { rows: [], rowCount: 4 } as T;
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

test('hashAppToken hashes app auth tokens without exposing raw values', () => {
  const raw = 'verification-token';
  const hashed = hashAppToken(raw);
  assert.notEqual(hashed, raw);
  assert.match(hashed, /^[a-f0-9]{64}$/);
});

test('AppTokenStore issues hashed one-time tokens with metadata', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const store = createAppTokenStore(client, {
    now: () => now,
    tokenFactory: () => 'raw-email-token',
  });

  const raw = await store.issue({
    userId: 'user-id',
    purpose: 'email_verification',
    metadata: { email: 'pilot@example.com' },
    ttlMs: 60_000,
  });

  assert.equal(raw, 'raw-email-token');
  const stored = client.tokens.get(hashAppToken(raw));
  assert.equal(stored?.token_hash, hashAppToken(raw));
  assert.equal(stored?.expires_at.toISOString(), '2026-07-11T12:01:00.000Z');

  const consumed = await store.consume('email_verification', raw);
  assert.equal(consumed?.userId, 'user-id');
  assert.deepEqual(consumed?.metadata, { email: 'pilot@example.com' });
  assert.equal(await store.consume('email_verification', raw), null);
});

test('AppTokenStore deletes expired tokens for a purpose', async () => {
  const client = new FakeClient();
  const store = createAppTokenStore(client);

  assert.equal(await store.deleteExpired('password_reset'), 4);
});

interface TokenRow {
  id: string;
  user_id: string | null;
  purpose: string;
  token_hash: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}
