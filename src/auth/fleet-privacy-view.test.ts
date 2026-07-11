import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('fleet routes scope boss and actor lookups to the current app user', () => {
  const fleet = readFileSync(resolve('src/routes/fleet.ts'), 'utf8');

  assert.match(fleet, /routeCurrentUser/);
  assert.match(fleet, /requireUser/);
  assert.match(fleet, /getOwnedCharacter/);
  assert.match(fleet, /getFleetBossCharacter/);
  assert.match(fleet, /listFleetInviteCharacters/);
  assert.doesNotMatch(fleet, /from ['"]\.\.\/db\.ts['"]/);
  assert.doesNotMatch(fleet, /SELECT \* FROM characters/);
  assert.doesNotMatch(fleet, /SELECT \* FROM characters WHERE is_boss = 1'\)/);
  assert.doesNotMatch(fleet, /SELECT \* FROM characters WHERE character_id = \?'\)/);
});
