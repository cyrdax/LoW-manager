import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { QueryClient } from '../db/migrations.ts';
import {
  createPostgresSavedSkillPlanStore,
  createSavedSkillPlanStore,
  migrateSavedSkillPlansDb,
} from './saved-plans-store.ts';

interface PgPlanRow {
  id: number;
  user_id: string;
  character_id: number;
  ship_id: number;
  mastery_level: number;
  label: string | null;
  saved_at: Date;
}

class FakePlanClient implements QueryClient {
  rows = new Map<number, PgPlanRow>();
  nextId = 1;

  async query<T>(text: string, params?: readonly unknown[]) {
    if (text.includes('INSERT INTO saved_skill_plans')) {
      const existing = Array.from(this.rows.values()).find(row =>
        row.user_id === params?.[0]
        && row.character_id === params?.[1]
        && row.ship_id === params?.[2]
        && row.mastery_level === params?.[3],
      );
      const row: PgPlanRow = existing ?? {
        id: this.nextId++,
        user_id: params?.[0] as string,
        character_id: params?.[1] as number,
        ship_id: params?.[2] as number,
        mastery_level: params?.[3] as number,
        label: null,
        saved_at: params?.[5] as Date,
      };
      row.label = params?.[4] as string | null;
      row.saved_at = params?.[5] as Date;
      this.rows.set(row.id, row);
      return { rows: [row], rowCount: 1 } as T;
    }

    if (text.includes('SELECT id, user_id, character_id, ship_id, mastery_level, label, saved_at') && text.includes('AND character_id = $2')) {
      const rows = Array.from(this.rows.values())
        .filter(row => row.user_id === params?.[0] && row.character_id === params?.[1])
        .sort((a, b) => b.saved_at.getTime() - a.saved_at.getTime());
      return { rows, rowCount: rows.length } as T;
    }

    if (text.includes('SELECT id, user_id, character_id, ship_id, mastery_level, label, saved_at')) {
      const rows = Array.from(this.rows.values())
        .filter(row => row.user_id === params?.[0])
        .sort((a, b) => b.saved_at.getTime() - a.saved_at.getTime());
      return { rows, rowCount: rows.length } as T;
    }

    if (text.includes('DELETE FROM saved_skill_plans')) {
      const id = Number(params?.[0]);
      const row = this.rows.get(id);
      const allowed = row?.user_id === params?.[1];
      if (allowed) this.rows.delete(id);
      return { rows: [], rowCount: allowed ? 1 : 0 } as T;
    }

    throw new Error(`unexpected query: ${text}`);
  }
}

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateSavedSkillPlansDb(db);
  return db;
}

test('SavedSkillPlanStore saves and lists plans scoped to a user', () => {
  const db = memoryDb();
  const store = createSavedSkillPlanStore(db, { now: () => 1000 });

  const saved = store.save({
    userId: 'user-a',
    characterId: 101,
    shipId: 19720,
    masteryLevel: 4,
    label: 'Main dread',
  });
  store.save({
    userId: 'user-b',
    characterId: 202,
    shipId: 23757,
    masteryLevel: 3,
    label: 'Carrier',
  });

  assert.equal(saved.user_id, 'user-a');
  assert.deepEqual(store.list('user-a').map(row => row.id), [saved.id]);
  assert.deepEqual(store.list('user-a', 101).map(row => row.ship_id), [19720]);
  assert.deepEqual(store.list('user-b').map(row => row.character_id), [202]);
});

test('SavedSkillPlanStore updates existing plans and deletes by owner only', () => {
  const db = memoryDb();
  let now = 1000;
  const store = createSavedSkillPlanStore(db, { now: () => now });

  const saved = store.save({
    userId: 'user-a',
    characterId: 101,
    shipId: 19720,
    masteryLevel: 4,
    label: 'Old',
  });

  now = 2000;
  const updated = store.save({
    userId: 'user-a',
    characterId: 101,
    shipId: 19720,
    masteryLevel: 4,
    label: 'New',
  });

  assert.equal(updated.id, saved.id);
  assert.equal(updated.label, 'New');
  assert.equal(updated.saved_at, 2000);
  assert.equal(store.delete('user-b', saved.id), false);
  assert.equal(store.delete('user-a', saved.id), true);
  assert.deepEqual(store.list('user-a'), []);
});

test('PostgresSavedSkillPlanStore maps timestamps and scopes rows by user', async () => {
  const client = new FakePlanClient();
  let now = new Date('2026-07-11T12:00:00Z');
  const store = createPostgresSavedSkillPlanStore(client, { now: () => now });

  const saved = await store.save({
    userId: 'user-a',
    characterId: 101,
    shipId: 19720,
    masteryLevel: 4,
    label: 'Main dread',
  });
  await store.save({
    userId: 'user-b',
    characterId: 202,
    shipId: 23757,
    masteryLevel: 3,
    label: 'Carrier',
  });

  assert.equal(saved.id, 1);
  assert.equal(saved.saved_at, Date.parse('2026-07-11T12:00:00Z'));
  assert.deepEqual((await store.list('user-a')).map(row => row.id), [saved.id]);
  assert.deepEqual((await store.list('user-a', 101)).map(row => row.ship_id), [19720]);
  assert.deepEqual((await store.list('user-b')).map(row => row.character_id), [202]);

  now = new Date('2026-07-11T13:00:00Z');
  const updated = await store.save({
    userId: 'user-a',
    characterId: 101,
    shipId: 19720,
    masteryLevel: 4,
    label: 'Updated',
  });

  assert.equal(updated.id, saved.id);
  assert.equal(updated.label, 'Updated');
  assert.equal(updated.saved_at, Date.parse('2026-07-11T13:00:00Z'));
  assert.equal(await store.delete('user-b', saved.id), false);
  assert.equal(await store.delete('user-a', saved.id), true);
  assert.deepEqual(await store.list('user-a'), []);
});
