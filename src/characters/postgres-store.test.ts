import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresCharacterStore } from './store.ts';
import type { QueryClient } from '../db/migrations.ts';
import type { EncryptedSecret } from '../auth/secret-box.ts';

class FakeClient implements QueryClient {
  rows = new Map<number, PgCharacterRow>();
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
    if (text.includes('INSERT INTO characters')) {
      const row: PgCharacterRow = {
        character_id: params?.[0] as number,
        user_id: params?.[1] as string,
        character_name: params?.[2] as string,
        owner_hash: params?.[3] as string,
        scopes: params?.[4] as string,
        refresh_token_enc: params?.[5] as EncryptedSecret,
        access_token_enc: params?.[6] as EncryptedSecret | null,
        access_token_expires_at: params?.[7] as Date | null,
        added_at: params?.[8] as Date,
        needs_reauth: false,
        is_boss: false,
      };
      this.rows.set(row.character_id, row);
      return { rows: [row], rowCount: 1 } as T;
    }
    if (text.includes('SELECT 1 FROM characters')) {
      const row = this.rows.get(Number(params?.[0]));
      const match = row?.user_id === params?.[1];
      return { rows: match ? [{ ok: 1 }] : [], rowCount: match ? 1 : 0 } as T;
    }
    if (text.includes('UPDATE characters') && text.includes('SET is_boss = false')) {
      for (const row of this.rows.values()) {
        if (row.user_id === params?.[0]) row.is_boss = false;
      }
      return { rows: [], rowCount: 0 } as T;
    }
    if (text.includes('UPDATE characters') && text.includes('SET is_boss = true')) {
      const row = this.rows.get(Number(params?.[0]));
      if (!row || row.user_id !== params?.[1]) return { rows: [], rowCount: 0 } as T;
      row.is_boss = true;
      return { rows: [], rowCount: 1 } as T;
    }
    if (text.includes('UPDATE characters') && text.includes('SET refresh_token_enc')) {
      const row = this.rows.get(Number(params?.[3]));
      if (!row) return { rows: [], rowCount: 0 } as T;
      row.refresh_token_enc = params?.[0] as EncryptedSecret;
      row.access_token_enc = params?.[1] as EncryptedSecret;
      row.access_token_expires_at = params?.[2] as Date;
      row.needs_reauth = false;
      return { rows: [row], rowCount: 1 } as T;
    }
    if (text.includes('UPDATE characters') && text.includes('SET needs_reauth = true')) {
      const row = this.rows.get(Number(params?.[0]));
      if (!row) return { rows: [], rowCount: 0 } as T;
      row.needs_reauth = true;
      return { rows: [{ character_id: row.character_id }], rowCount: 1 } as T;
    }
    if (text.includes('DELETE FROM characters')) {
      const row = this.rows.get(Number(params?.[0]));
      if (!row || row.user_id !== params?.[1]) return { rows: [], rowCount: 0 } as T;
      this.rows.delete(row.character_id);
      return { rows: [], rowCount: 1 } as T;
    }
    if (text.includes('SELECT character_id FROM characters') && text.includes('WHERE user_id = $1')) {
      const rows = Array.from(this.rows.values())
        .filter(row => row.user_id === params?.[0])
        .sort((a, b) => a.added_at.getTime() - b.added_at.getTime())
        .map(row => ({ character_id: row.character_id }));
      return { rows, rowCount: rows.length } as T;
    }
    if (text.includes('WHERE character_id = $1 AND user_id = $2')) {
      const row = this.rows.get(Number(params?.[0]));
      const rows = row?.user_id === params?.[1] ? [row] : [];
      return { rows, rowCount: rows.length } as T;
    }
    if (text.includes('WHERE character_id = $1')) {
      const row = this.rows.get(Number(params?.[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 } as T;
    }
    if (text.includes('WHERE user_id = $1 AND needs_reauth = false')) {
      const rows = Array.from(this.rows.values())
        .filter(row => row.user_id === params?.[0] && !row.needs_reauth)
        .sort((a, b) => a.added_at.getTime() - b.added_at.getTime());
      return { rows, rowCount: rows.length } as T;
    }
    if (text.includes('WHERE user_id = $1')) {
      const rows = Array.from(this.rows.values())
        .filter(row => row.user_id === params?.[0])
        .sort((a, b) => a.added_at.getTime() - b.added_at.getTime());
      return { rows, rowCount: rows.length } as T;
    }
    throw new Error(`unexpected query: ${text}`);
  }
}

test('PostgresCharacterStore encrypts tokens and returns CharacterRow-shaped pilots', async () => {
  const client = new FakeClient();
  const store = createPostgresCharacterStore(client, {
    now: () => new Date('2026-07-11T12:00:00Z'),
    secretKey: Buffer.alloc(32, 7),
  });

  const saved = await store.upsertAuthorized({
    characterId: 101,
    userId: 'user-a',
    characterName: 'Alpha',
    ownerHash: 'owner-a',
    scopes: 'scope',
    refreshToken: 'refresh-a',
    accessToken: 'access-a',
    accessTokenExpiresAt: Date.parse('2026-07-11T13:00:00Z'),
  });

  const stored = client.rows.get(101);
  assert.ok(stored);
  assert.notEqual(stored.refresh_token_enc.ciphertext, 'refresh-a');
  assert.equal(saved.refresh_token, 'refresh-a');
  assert.equal(saved.access_token, 'access-a');
  assert.equal(saved.access_token_expires_at, Date.parse('2026-07-11T13:00:00Z'));
  assert.equal(saved.added_at, Date.parse('2026-07-11T12:00:00Z'));

  const listed = await store.listByUser('user-a');
  assert.equal(listed[0].character_name, 'Alpha');
  assert.equal(listed[0].refresh_token, 'refresh-a');
});

test('PostgresCharacterStore preserves scoped ownership helpers', async () => {
  const client = new FakeClient();
  const store = createPostgresCharacterStore(client, {
    now: () => new Date('2026-07-11T12:00:00Z'),
    secretKey: Buffer.alloc(32, 9),
  });

  await store.upsertAuthorized({
    characterId: 101,
    userId: 'user-a',
    characterName: 'Alpha',
    ownerHash: 'owner-a',
    scopes: 'scope',
    refreshToken: 'refresh-a',
    accessToken: null,
    accessTokenExpiresAt: null,
  });
  await store.upsertAuthorized({
    characterId: 202,
    userId: 'user-b',
    characterName: 'Beta',
    ownerHash: 'owner-b',
    scopes: 'scope',
    refreshToken: 'refresh-b',
    accessToken: null,
    accessTokenExpiresAt: null,
  });

  assert.deepEqual(await store.listIdsByUser('user-a'), [101]);
  assert.equal(await store.owns('user-a', 101), true);
  assert.equal(await store.owns('user-b', 101), false);
  assert.equal((await store.getOwned('user-a', 101))?.character_name, 'Alpha');

  const bossRows = await store.setBoss('user-a', 101);
  assert.equal(bossRows.find(row => row.character_id === 101)?.is_boss, 1);
  assert.equal(client.inTransaction, false);

  assert.equal(await store.deleteOwned('user-b', 101), false);
  assert.equal(await store.deleteOwned('user-a', 101), true);
  assert.equal(await store.getById(101), undefined);
});

test('PostgresCharacterStore updates refreshed tokens and marks reauth state', async () => {
  const client = new FakeClient();
  const key = Buffer.alloc(32, 3);
  const store = createPostgresCharacterStore(client, {
    now: () => new Date('2026-07-11T12:00:00Z'),
    secretKey: key,
  });
  await store.upsertAuthorized({
    characterId: 101,
    userId: 'user-a',
    characterName: 'Alpha',
    ownerHash: 'owner-a',
    scopes: 'scope',
    refreshToken: 'refresh-a',
    accessToken: 'access-a',
    accessTokenExpiresAt: 9000,
  });

  const updated = await store.updateTokens(101, {
    refreshToken: 'refresh-new',
    accessToken: 'access-new',
    accessTokenExpiresAt: Date.parse('2026-07-11T13:00:00Z'),
  });
  assert.equal(updated?.refresh_token, 'refresh-new');
  assert.equal(updated?.access_token, 'access-new');
  assert.equal(updated?.needs_reauth, 0);
  assert.notEqual(client.rows.get(101)?.refresh_token_enc.ciphertext, 'refresh-new');

  assert.equal(await store.markNeedsReauth(101), true);
  assert.equal((await store.getById(101))?.needs_reauth, 1);
  assert.equal(await store.markNeedsReauth(999), false);
});

interface PgCharacterRow {
  character_id: number;
  user_id: string;
  character_name: string;
  owner_hash: string;
  scopes: string;
  refresh_token_enc: EncryptedSecret;
  access_token_enc: EncryptedSecret | null;
  access_token_expires_at: Date | null;
  added_at: Date;
  needs_reauth: boolean;
  is_boss: boolean;
}
