import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSqliteCharacterStore, migrateCharactersDb } from './store.ts';

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateCharactersDb(db);
  return db;
}

test('CharacterStore scopes authorized pilots by app user', () => {
  const db = memoryDb();
  const store = createSqliteCharacterStore(db, { now: () => 1000 });

  const alpha = store.upsertAuthorized({
    characterId: 101,
    userId: 'user-a',
    characterName: 'Alpha',
    ownerHash: 'owner-a',
    scopes: 'esi-location.read_location.v1',
    refreshToken: 'refresh-a',
    accessToken: 'access-a',
    accessTokenExpiresAt: 9000,
  });
  store.upsertAuthorized({
    characterId: 202,
    userId: 'user-b',
    characterName: 'Beta',
    ownerHash: 'owner-b',
    scopes: 'esi-location.read_location.v1',
    refreshToken: 'refresh-b',
    accessToken: 'access-b',
    accessTokenExpiresAt: 9000,
  });

  assert.equal(alpha.added_at, 1000);
  assert.deepEqual(store.listByUser('user-a').map(row => row.character_id), [101]);
  assert.deepEqual(store.listIdsByUser('user-b'), [202]);
  assert.equal(store.owns('user-a', 101), true);
  assert.equal(store.owns('user-b', 101), false);
  assert.equal(store.getOwned('user-a', 101)?.character_name, 'Alpha');
});

test('CharacterStore handles reauth filtering boss selection and scoped deletes', () => {
  const db = memoryDb();
  const store = createSqliteCharacterStore(db, { now: () => 1000 });
  store.upsertAuthorized({
    characterId: 101,
    userId: 'user-a',
    characterName: 'Alpha',
    ownerHash: 'owner-a',
    scopes: 'scope',
    refreshToken: 'refresh-a',
    accessToken: 'access-a',
    accessTokenExpiresAt: 9000,
  });
  store.upsertAuthorized({
    characterId: 102,
    userId: 'user-a',
    characterName: 'Needs Reauth',
    ownerHash: 'owner-a2',
    scopes: 'scope',
    refreshToken: 'refresh-a2',
    accessToken: 'access-a2',
    accessTokenExpiresAt: 9000,
  });
  db.prepare('UPDATE characters SET needs_reauth = 1 WHERE character_id = 102').run();

  assert.deepEqual(store.listUsableByUser('user-a').map(row => row.character_id), [101]);

  const bossRows = store.setBoss('user-a', 101);
  assert.equal(bossRows.find(row => row.character_id === 101)?.is_boss, 1);
  assert.equal(bossRows.find(row => row.character_id === 102)?.is_boss, 0);

  assert.equal(store.deleteOwned('user-b', 101), false);
  assert.equal(store.deleteOwned('user-a', 101), true);
  assert.equal(store.getById(101), undefined);
});
