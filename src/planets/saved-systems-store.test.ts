import assert from 'node:assert/strict';
import test from 'node:test';
import { createSavedSystemsStore } from './saved-systems-store.ts';
import type { QueryClient } from '../db/migrations.ts';

class FakeClient implements QueryClient {
  rows = new Map<number, { system_id: number; system_name: string; saved_at: Date }>();

  async query<T>(text: string, params?: readonly unknown[]) {
    if (text.includes('SELECT system_id, system_name, saved_at FROM saved_systems')) {
      const rows = Array.from(this.rows.values())
        .sort((a, b) => a.system_name.localeCompare(b.system_name));
      return { rows, rowCount: rows.length } as T;
    }

    if (text.includes('SELECT system_id FROM saved_systems')) {
      const id = Number(params?.[0]);
      const row = this.rows.get(id);
      return { rows: row ? [{ system_id: id }] : [], rowCount: row ? 1 : 0 } as T;
    }

    if (text.includes('INSERT INTO saved_systems')) {
      const id = Number(params?.[0]);
      this.rows.set(id, {
        system_id: id,
        system_name: String(params?.[1]),
        saved_at: params?.[2] as Date,
      });
      return { rows: [], rowCount: 1 } as T;
    }

    if (text.includes('DELETE FROM saved_systems')) {
      const deleted = this.rows.delete(Number(params?.[0]));
      return { rows: [], rowCount: deleted ? 1 : 0 } as T;
    }

    throw new Error(`unexpected query: ${text}`);
  }
}

test('SavedSystemsStore lists saved systems sorted by name with epoch savedAt', async () => {
  const client = new FakeClient();
  const now = new Date('2026-07-11T12:00:00Z');
  const store = createSavedSystemsStore(client, { now: () => now });

  await store.add(30_000_142, 'Jita');
  await store.add(30_002_187, 'Amarr');

  assert.deepEqual(await store.list(), [
    { systemId: 30_002_187, systemName: 'Amarr', savedAt: now.getTime() },
    { systemId: 30_000_142, systemName: 'Jita', savedAt: now.getTime() },
  ]);
});

test('SavedSystemsStore detects existing rows and deletes saved systems', async () => {
  const client = new FakeClient();
  const store = createSavedSystemsStore(client);

  await store.add(30_000_142, 'Jita');
  assert.equal(await store.has(30_000_142), true);

  await store.delete(30_000_142);
  assert.equal(await store.has(30_000_142), false);
});
