import assert from 'node:assert/strict';
import test from 'node:test';
import { createUniverseCacheStore } from './universe-cache-store.ts';
import type { QueryClient } from '../db/migrations.ts';

interface NameRow {
  category: string;
  id: number;
  name: string;
}

class FakeClient implements QueryClient {
  names = new Map<string, string>();
  corporations = new Map<number, { name: string; ticker: string }>();

  async query<T>(text: string, params?: readonly unknown[]) {
    if (text.includes('SELECT name FROM universe_names')) {
      const category = String(params?.[0]);
      const id = Number(params?.[1]);
      const name = this.names.get(key(category, id));
      return { rows: name ? [{ name }] : [], rowCount: name ? 1 : 0 } as T;
    }

    if (text.includes('INSERT INTO universe_names') && text.includes('unnest')) {
      const category = String(params?.[0]);
      const ids = params?.[1] as number[];
      const names = params?.[2] as string[];
      ids.forEach((id, index) => this.names.set(key(category, Number(id)), names[index]));
      return { rows: [], rowCount: ids.length } as T;
    }

    if (text.includes('INSERT INTO universe_names')) {
      this.names.set(key(String(params?.[0]), Number(params?.[1])), String(params?.[2]));
      return { rows: [], rowCount: 1 } as T;
    }

    if (text.includes('COUNT(*)::int')) {
      const category = String(params?.[0]);
      const count = Array.from(this.names.keys()).filter(k => k.startsWith(`${category}:`)).length;
      return { rows: [{ count }], rowCount: 1 } as T;
    }

    if (text.includes('LEFT JOIN universe_names')) {
      const category = String(params?.[1]);
      const ids = params?.[0] as number[];
      const rows = ids
        .filter(id => !this.names.has(key(category, Number(id))))
        .map(id => ({ id: Number(id) }));
      return { rows, rowCount: rows.length } as T;
    }

    if (text.includes('name ILIKE')) {
      const category = String(params?.[0]);
      const pattern = String(params?.[1]).replaceAll('%', '').toLowerCase();
      const prefixOnly = !String(params?.[1]).startsWith('%');
      const limit = Number(params?.[2]);
      const rows = Array.from(this.names.entries())
        .filter(([k, name]) => k.startsWith(`${category}:`)
          && (prefixOnly ? name.toLowerCase().startsWith(pattern) : name.toLowerCase().includes(pattern)))
        .map(([k, name]) => ({ id: Number(k.split(':')[1]), name }))
        .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        .slice(0, limit);
      return { rows, rowCount: rows.length } as T;
    }

    if (text.includes('SELECT name, ticker FROM corporations')) {
      const corp = this.corporations.get(Number(params?.[0]));
      return { rows: corp ? [corp] : [], rowCount: corp ? 1 : 0 } as T;
    }

    if (text.includes('INSERT INTO corporations')) {
      this.corporations.set(Number(params?.[0]), { name: String(params?.[1]), ticker: String(params?.[2]) });
      return { rows: [], rowCount: 1 } as T;
    }

    throw new Error(`unexpected query: ${text}`);
  }
}

test('UniverseCacheStore stores and reads cached names without SQLite', async () => {
  const client = new FakeClient();
  const store = createUniverseCacheStore(client);

  assert.equal(await store.getName('system', 30000142), null);
  await store.setName('system', 30000142, 'Jita');

  assert.equal(await store.getName('system', 30000142), 'Jita');
  assert.equal(await store.countNames('system'), 1);
});

test('UniverseCacheStore bulk inserts names and reports missing ids', async () => {
  const client = new FakeClient();
  const store = createUniverseCacheStore(client);

  await store.setNames('system', [
    { id: 1, name: 'Alpha' },
    { id: 3, name: 'Gamma' },
  ]);

  assert.deepEqual(await store.missingNameIds('system', [1, 2, 3, 4]), [2, 4]);
});

test('UniverseCacheStore searches prefix matches before substring matches', async () => {
  const client = new FakeClient();
  const store = createUniverseCacheStore(client);
  await store.setNames('system', [
    { id: 1, name: 'Jita' },
    { id: 2, name: 'Perjita' },
    { id: 3, name: 'Mitsolen' },
    { id: 4, name: 'Jita IV' },
  ]);

  assert.deepEqual(await store.searchNames('system', 'ji', 3), [
    { id: 1, name: 'Jita' },
    { id: 4, name: 'Jita IV' },
    { id: 2, name: 'Perjita' },
  ]);
});

test('UniverseCacheStore stores and reads corporation cache rows', async () => {
  const client = new FakeClient();
  const store = createUniverseCacheStore(client);

  assert.equal(await store.getCorporation(98_434_315), null);
  await store.setCorporation(98_434_315, { name: 'Deepwater Hooligans', ticker: 'BIGAB' });

  assert.deepEqual(await store.getCorporation(98_434_315), { name: 'Deepwater Hooligans', ticker: 'BIGAB' });
});

function key(category: string, id: number): string {
  return `${category}:${id}`;
}
