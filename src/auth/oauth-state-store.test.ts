import assert from 'node:assert/strict';
import test from 'node:test';
import { createOAuthStateStore, hashState } from './oauth-state-store.ts';
import type { QueryClient } from '../db/migrations.ts';

class FakeClient implements QueryClient {
  queries: Array<{ text: string; params?: readonly unknown[] }> = [];
  validHashes = new Set<string>();

  async query<T>(text: string, params?: readonly unknown[]) {
    this.queries.push({ text, params });
    if (text.includes('INSERT INTO auth_tokens')) {
      this.validHashes.add(String(params?.[0]));
      return { rows: [], rowCount: 1 } as T;
    }
    if (text.includes('UPDATE auth_tokens')) {
      const hash = String(params?.[0]);
      const consumed = this.validHashes.delete(hash);
      return { rows: consumed ? [{ id: 'token-id' }] : [], rowCount: consumed ? 1 : 0 } as T;
    }
    if (text.includes('DELETE FROM auth_tokens')) {
      return { rows: [], rowCount: 3 } as T;
    }
    return { rows: [], rowCount: 0 } as T;
  }
}

test('hashState hashes OAuth state values without exposing the raw state', () => {
  const raw = 'state-value';
  const hashed = hashState(raw);
  assert.notEqual(hashed, raw);
  assert.match(hashed, /^[a-f0-9]{64}$/);
});

test('OAuthStateStore issues hashed state and consumes it once', async () => {
  const client = new FakeClient();
  const store = createOAuthStateStore(client, { now: () => new Date('2026-07-11T12:00:00Z') });

  const state = await store.issue({ redirect: '/fits' });
  assert.equal(client.queries[0].params?.[0], hashState(state));
  assert.notEqual(client.queries[0].params?.[0], state);
  assert.equal(await store.consume(state), true);
  assert.equal(await store.consume(state), false);
});

test('OAuthStateStore deletes expired state rows', async () => {
  const client = new FakeClient();
  const store = createOAuthStateStore(client);

  assert.equal(await store.deleteExpired(), 3);
  assert.match(client.queries[0].text, /DELETE FROM auth_tokens/);
});
