import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('private pilot action routes verify character ownership before using ESI data or tokens', () => {
  const db = readFileSync(resolve('src/db.ts'), 'utf8');
  const helper = readFileSync(resolve('src/auth/pilot-access.ts'), 'utf8');
  const autopilot = readFileSync(resolve('src/routes/autopilot.ts'), 'utf8');
  const market = readFileSync(resolve('src/routes/market.ts'), 'utf8');
  const fits = readFileSync(resolve('src/routes/fits.ts'), 'utf8');
  const skills = readFileSync(resolve('src/routes/skills.ts'), 'utf8');

  assert.match(helper, /export function ownsCharacter/);
  assert.match(helper, /createSqliteCharacterStore/);
  assert.match(helper, /\.owns\(userId, characterId\)/);
  assert.match(helper, /\.listUsableByUser\(userId\)/);

  assert.match(db, /user_id\s+TEXT/);
  assert.match(db, /CREATE INDEX IF NOT EXISTS idx_saved_skill_plans_user/);

  assert.match(autopilot, /listUsableCharacters/);
  assert.match(market, /requireOwnedCharacter/);
  assert.match(fits, /requireOwnedCharacter/);
  assert.match(skills, /requireOwnedCharacter/);
  assert.match(skills, /saved_skill_plans WHERE user_id = \?/);
});
