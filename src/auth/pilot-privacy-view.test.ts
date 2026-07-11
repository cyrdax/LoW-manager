import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('pilot authorization and realtime character routes are scoped to the current app user', () => {
  const db = readFileSync(resolve('src/db.ts'), 'utf8');
  const sso = readFileSync(resolve('src/auth/sso.ts'), 'utf8');
  const characters = readFileSync(resolve('src/routes/characters.ts'), 'utf8');
  const stream = readFileSync(resolve('src/routes/stream.ts'), 'utf8');

  assert.match(db, /user_id\s+TEXT/);
  assert.match(sso, /issue\(\{ userId: user\.id \}\)/);
  assert.match(sso, /upsertAuthorized/);

  assert.match(characters, /createSqliteCharacterStore/);
  assert.match(characters, /listByUser\(user\.id\)/);
  assert.match(characters, /deleteOwned\(user\.id, id\)/);
  assert.match(characters, /setBoss\(user\.id, parsed\.data\.character_id\)/);
  assert.match(characters, /\/api\/characters\/main/);
  assert.match(characters, /setMainCharacter/);

  assert.match(stream, /listIdsByUser\(user\.id\)/);
  assert.match(stream, /characterId/);
});
