import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('polling scheduler reads pilots through the character store boundary', () => {
  const scheduler = readFileSync(resolve('src/polling/scheduler.ts'), 'utf8');

  assert.doesNotMatch(scheduler, /from ['"]\.\.\/db\.ts['"]/);
  assert.match(scheduler, /createSqliteCharacterStore/);
  assert.match(scheduler, /interface PollingCharacterStore/);
  assert.match(scheduler, /startPolling\(deps: PollingDeps = \{\}\)/);
  assert.match(scheduler, /let activeCharacters: PollingCharacterStore \| null = null/);
  assert.match(scheduler, /await characters\.listAll\(\)/);
  assert.match(scheduler, /const characters = activeCharacters/);
  assert.match(scheduler, /await characters\.getById\(id\)/);
});
