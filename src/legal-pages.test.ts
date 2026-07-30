import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('public legal pages are available for Discord bot verification', () => {
  const termsPath = resolve('web/public/terms-of-service.html');
  const privacyPath = resolve('web/public/privacy-policy.html');
  const server = readFileSync(resolve('src/server.ts'), 'utf8');

  assert.equal(existsSync(termsPath), true);
  assert.equal(existsSync(privacyPath), true);

  const terms = readFileSync(termsPath, 'utf8');
  const privacy = readFileSync(privacyPath, 'utf8');

  assert.match(terms, /Terms of Service/);
  assert.match(terms, /LoW Manager/);
  assert.match(terms, /Discord Bot/);
  assert.match(terms, /cyrdax@gmail\.com/);

  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /Discord server IDs/);
  assert.match(privacy, /message content/);
  assert.match(privacy, /delete/i);
  assert.match(privacy, /cyrdax@gmail\.com/);

  assert.match(server, /app\.get\('\/terms-of-service'/);
  assert.match(server, /sendLegalPage\(reply, 'terms-of-service\.html'\)/);
  assert.match(server, /app\.get\('\/privacy-policy'/);
  assert.match(server, /sendLegalPage\(reply, 'privacy-policy\.html'\)/);
  assert.ok(server.indexOf("app.get('/terms-of-service'") < server.indexOf('app.register(fastifyStatic'));
  assert.ok(server.indexOf("app.get('/privacy-policy'") < server.indexOf('app.register(fastifyStatic'));
});
