import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('frontend exposes auth api helpers and gates the dashboard behind login', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const authGate = readFileSync(resolve('web/src/components/AuthGate.tsx'), 'utf8');
  const controlPanel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');
  const charsHook = readFileSync(resolve('web/src/hooks/useCharacters.ts'), 'utf8');
  const server = readFileSync(resolve('src/server.ts'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(api, /export interface CurrentUser/);
  assert.match(api, /export async function fetchCurrentUser/);
  assert.match(api, /export async function signup/);
  assert.match(api, /export async function login/);
  assert.match(api, /export async function logout/);
  assert.match(api, /export async function requestPasswordReset/);
  assert.match(api, /export async function completePasswordReset/);
  assert.match(api, /export async function setMainCharacter/);

  assert.match(app, /AuthGate/);
  assert.match(app, /fetchCurrentUser/);
  assert.match(app, /if \(!currentUser\)/);
  assert.match(app, /setCurrentUser\(\{\s*\.\.\.currentUser,\s*mainCharacterId/);
  assert.match(charsHook, /enabled = true/);

  assert.match(controlPanel, /Main pilot/);
  assert.match(controlPanel, /main-pilot-select/);
  assert.match(controlPanel, /portraitUrl/);

  assert.match(authGate, /Create account/);
  assert.match(authGate, /Sign in/);
  assert.match(authGate, /Continue with Google/);
  assert.match(authGate, /\/auth\/google\/start/);
  assert.match(authGate, /Forgot password\?/);
  assert.doesNotMatch(authGate, />Reset password<\/button>/);
  assert.match(authGate, /requestPasswordReset/);
  assert.match(authGate, /completePasswordReset/);
  assert.match(styles, /grid-template-columns: repeat\(2, 1fr\)/);

  assert.match(server, /\/auth\/password\/reset/);
});

test('sidebar main navigation follows the requested workflow order', () => {
  const controlPanel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');
  const navStart = controlPanel.indexOf('<div className="view-nav');
  const navEnd = controlPanel.indexOf('</div>', navStart);
  const navBlock = controlPanel.slice(navStart, navEnd);
  const labels = Array.from(navBlock.matchAll(/>\s*([A-Za-z]+)\s*<\/button>/g), match => match[1]);

  assert.deepEqual(labels, ['Pilots', 'Fleet', 'Fits', 'Market', 'Contract', 'Industry', 'Planets']);
  assert.match(navBlock, /view-nav-7/);
});
