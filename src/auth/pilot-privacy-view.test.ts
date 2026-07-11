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
  assert.match(sso, /INSERT INTO characters \(character_id, user_id,/);
  assert.match(sso, /ON CONFLICT\(character_id\) DO UPDATE SET[\s\S]*user_id = excluded\.user_id/);

  assert.match(characters, /WHERE user_id = \?/);
  assert.match(characters, /WHERE character_id = \? AND user_id = \?/);
  assert.match(characters, /UPDATE characters SET is_boss = 0 WHERE user_id = \?/);

  assert.match(stream, /WHERE user_id = \?/);
  assert.match(stream, /characterId/);
});
