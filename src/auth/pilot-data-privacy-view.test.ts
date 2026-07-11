import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('pilot-derived PI and industry routes only read data for the current app user', () => {
  const helper = readFileSync(resolve('src/auth/pilot-access.ts'), 'utf8');
  const planets = readFileSync(resolve('src/routes/planets.ts'), 'utf8');
  const industry = readFileSync(resolve('src/routes/industry.ts'), 'utf8');

  assert.match(helper, /export async function userCharacterIds/);
  assert.match(helper, /createSqliteCharacterStore/);
  assert.match(helper, /listIdsByUser\(userId\)/);

  assert.match(planets, /routeCurrentUser/);
  assert.match(planets, /await userCharacterIds\(user\.id\)/);
  assert.match(planets, /overlayByPlanetId\(characterIds\)/);
  assert.match(planets, /allColonyPins\(\)\.filter\(entry => characterIds\.has\(entry\.characterId\)\)/);
  assert.match(planets, /requireOwnedCharacter/);

  assert.match(industry, /routeCurrentUser/);
  assert.match(industry, /requireOwnedCharacter/);
  assert.match(industry, /characterId !== 'max'/);
});
