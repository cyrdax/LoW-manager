import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSavedSkillPlanStore, migrateSavedSkillPlansDb } from './saved-plans-store.ts';

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
