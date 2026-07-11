import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  readMigrations,
  runMigrationsWithClient,
  type Migration,
  type QueryClient,
} from './migrations.ts';

class FakeClient implements QueryClient {
  queries: Array<{ text: string; params?: readonly unknown[] }> = [];
  applied = new Map<string, string>();

  async query<T>(text: string, params?: readonly unknown[]) {
    this.queries.push({ text: compact(text), params });
    if (text.startsWith('SELECT id, checksum FROM schema_migrations')) {
      return {
        rows: [...this.applied.entries()].map(([id, checksum]) => ({ id, checksum })),
      } as T;
    }
    if (text.startsWith('INSERT INTO schema_migrations')) {
      this.applied.set(String(params?.[0]), String(params?.[2]));
    }
    return { rows: [] } as T;
  }
}

test('readMigrations returns sorted sql migrations with checksums', () => {
  const dir = mkdtempSync(join(tmpdir(), 'efd-migrations-'));
  try {
    writeFileSync(join(dir, '002_second.sql'), 'SELECT 2;\n');
    writeFileSync(join(dir, '001_first.sql'), 'SELECT 1;\n');
    writeFileSync(join(dir, 'notes.txt'), 'ignore me');

    const migrations = readMigrations(dir);
    assert.deepEqual(migrations.map(m => m.id), ['001_first', '002_second']);
    assert.equal(migrations[0].sql, 'SELECT 1;');
    assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runMigrationsWithClient applies pending migrations inside a transaction', async () => {
  const client = new FakeClient();
  const migrations: Migration[] = [
    { id: '001_existing', name: '001_existing.sql', checksum: 'same', sql: 'SELECT 1;' },
    { id: '002_new', name: '002_new.sql', checksum: 'newhash', sql: 'SELECT 2;' },
  ];
  client.applied.set('001_existing', 'same');

  const result = await runMigrationsWithClient(client, migrations);

  assert.deepEqual(result, { applied: ['002_new'], skipped: ['001_existing'] });
  assert.equal(client.queries.some(q => q.text === 'BEGIN'), true);
  assert.equal(client.queries.some(q => q.text === 'COMMIT'), true);
  assert.equal(client.applied.get('002_new'), 'newhash');
});

test('runMigrationsWithClient rejects checksum drift', async () => {
  const client = new FakeClient();
  client.applied.set('001_existing', 'oldhash');

  await assert.rejects(
    () => runMigrationsWithClient(client, [
      { id: '001_existing', name: '001_existing.sql', checksum: 'newhash', sql: 'SELECT 1;' },
    ]),
    /checksum changed/,
  );
  assert.equal(client.queries.some(q => q.text === 'ROLLBACK'), true);
});

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
