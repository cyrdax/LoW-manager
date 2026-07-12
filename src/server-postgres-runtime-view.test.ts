import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('server wires Postgres stores into runtime pilot and skill-plan paths', () => {
  const server = readFileSync(resolve('src/server.ts'), 'utf8');

  assert.match(server, /createPostgresCharacterStore/);
  assert.match(server, /createPostgresDoctrineStore/);
  assert.match(server, /createPostgresFitStore/);
  assert.match(server, /createPostgresSavedSkillPlanStore/);
  assert.match(server, /serverListenOptionsFromEnv/);
  assert.match(server, /cookieSecretFromEnv/);
  assert.match(server, /secureCookiesFromEnv/);
  assert.match(server, /setPilotAccessCharacterStore\(characterStore\)/);
  assert.match(server, /setAccessTokenCharacterStore\(characterStore\)/);
  assert.match(server, /registerSsoRoutes\(app, \{ characters: characterStore \}\)/);
  assert.match(server, /registerCharacterRoutes\(app, \{ characters: characterStore \}\)/);
  assert.match(server, /registerStreamRoute\(app, \{ characters: characterStore \}\)/);
  assert.match(server, /registerSkillsRoutes\(app, \{ savedPlans: savedSkillPlans \}\)/);
  assert.match(server, /registerFitRoutes\(app, \{ store: fitStore \}\)/);
  assert.match(server, /registerDoctrineRoutes\(app, \{ store: doctrineStore, fitStore \}\)/);
  assert.match(server, /app\.get\('\/api\/health'/);
  assert.match(server, /startPolling\(\{ characters: characterStore \}\)/);
});

test('Postgres runtime modules avoid importing the SQLite singleton fallback', () => {
  const runtimeModules = [
    'src/routes/fits.ts',
    'src/routes/doctrines.ts',
    'src/characters/store.ts',
    'src/skills/saved-plans-store.ts',
  ];

  for (const file of runtimeModules) {
    const source = readFileSync(resolve(file), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\.\/db\.ts['"]/);
  }

  const scheduler = readFileSync(resolve('src/polling/scheduler.ts'), 'utf8');
  assert.doesNotMatch(scheduler, /let\s+activeCharacters[^=]*=\s*createSqliteCharacterStore\(\)/);

  const sso = readFileSync(resolve('src/auth/sso.ts'), 'utf8');
  assert.doesNotMatch(sso, /const characterStore = deps\.characters \?\? createSqliteCharacterStore\(\)/);
});
