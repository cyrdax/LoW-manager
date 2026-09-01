import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('frontend exposes auth api helpers and gates the dashboard behind login', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const authGate = readFileSync(resolve('web/src/components/AuthGate.tsx'), 'utf8');
  const controlPanel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');
  const pilotTools = readFileSync(resolve('web/src/components/PilotTools.tsx'), 'utf8');
  const charsHook = readFileSync(resolve('web/src/hooks/useCharacters.ts'), 'utf8');
  const server = readFileSync(resolve('src/server.ts'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');
  const authGateStyles = readFileSync(resolve('web/src/components/AuthGate.css'), 'utf8');

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

  assert.match(controlPanel, /portraitUrl/);
  assert.doesNotMatch(controlPanel, /Main pilot/);
  assert.match(pilotTools, /Main pilot/);
  assert.match(pilotTools, /main-pilot-select/);

  assert.match(authGate, /Create account/);
  assert.match(authGate, /Sign in/);
  assert.match(authGate, /Continue with Google/);
  assert.match(authGate, /googleStartUrl/);
  assert.match(authGate, /const eveStartUrl = useMemo/);
  assert.match(authGate, /\/auth\/eve\/start/);
  assert.match(authGate, /intent: 'account'/);
  assert.match(authGate, />Continue with EVE</);
  assert.match(authGate, /eve_owner_mismatch/);
  assert.match(authGate, /eve_auth_failed/);
  assert.match(authGate, /returnTo/);
  assert.match(authGate, /Forgot password\?/);
  assert.doesNotMatch(authGate, />Reset password<\/button>/);
  assert.match(authGate, /requestPasswordReset/);
  assert.match(authGate, /completePasswordReset/);
  assert.match(styles, /grid-template-columns: repeat\(2, 1fr\)/);
  assert.match(authGateStyles, /\.auth-provider-actions/);
  assert.match(authGateStyles, /\.eve-auth-button/);
  assert.match(authGateStyles, /:focus-visible/);

  assert.match(server, /\/auth\/password\/reset/);
});

test('frontend lets anonymous users view public fit and doctrine routes read-only', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const fitsView = readFileSync(resolve('web/src/components/FitsView.tsx'), 'utf8');
  const doctrinesView = readFileSync(resolve('web/src/components/DoctrinesView.tsx'), 'utf8');

  assert.match(app, /const publicRoute = \['fits', 'fitsV2', 'market', 'contracts'\]\.includes\(route\.view\)/);
  assert.match(app, /if \(!currentUser && !publicRoute\)/);
  assert.match(app, /currentUser=\{currentUser\}/);
  assert.match(app, /chars=\{currentUser \? list : \[\]\}/);

  assert.match(fitsView, /currentUser\?: CurrentUser \| null/);
  assert.match(fitsView, /const anonymous = !currentUser/);
  assert.match(fitsView, /const effectiveVisibility = anonymous \? 'public' : visibility/);
  assert.match(fitsView, /if \(anonymous && visibility !== 'public'\) setVisibility\('public'\)/);
  assert.match(fitsView, /currentUser \? <LibraryScopeSwitch/);
  assert.match(fitsView, /editable=\{!anonymous && canEditActive\}/);
  assert.match(fitsView, /canCopyPrivate=\{!anonymous && canCopyPrivate\}/);
  assert.match(fitsView, /showSendControls=\{!anonymous\}/);

  assert.match(doctrinesView, /currentUser\?: CurrentUser \| null/);
  assert.match(doctrinesView, /const anonymous = !currentUser/);
  assert.match(doctrinesView, /const effectiveVisibility = anonymous \? 'public' : visibility/);
  assert.match(doctrinesView, /currentUser && <button className="fl-refresh"/);
  assert.match(doctrinesView, /const canStartEditing = !!detail && !!currentUser/);
});

test('frontend keeps market public while gating private contract actions', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const authGate = readFileSync(resolve('web/src/components/AuthGate.tsx'), 'utf8');
  const marketView = readFileSync(resolve('web/src/components/MarketView.tsx'), 'utf8');
  const contractsView = readFileSync(resolve('web/src/components/ContractsView.tsx'), 'utf8');

  assert.match(app, /const publicRoute = \['fits', 'fitsV2', 'market', 'contracts'\]\.includes\(route\.view\)/);
  assert.match(app, /if \(!currentUser && !publicRoute\)/);
  assert.match(app, /<MarketView[\s\S]*initialTab=\{route\.view === 'market'/);
  assert.match(app, /<ContractsView currentUser=\{currentUser\}/);
  assert.match(app, /onLoginRequired=\{showLogin\}/);
  assert.match(app, /function showLogin\(\)/);

  assert.match(authGate, /const value = params\.get\('returnTo'\)/);
  assert.match(authGate, /value && value\.startsWith\('\/'\) && !value\.startsWith\('\/\/'\)/);
  assert.match(authGate, /finishAuthenticated\(res\.user\)/);

  assert.match(marketView, /tab === 'shopping' \? <ShoppingListView \/> : <PlexView \/>/);
  assert.doesNotMatch(marketView, /CurrentUser|onLoginRequired|Log in to send to a pilot/);

  assert.match(contractsView, /currentUser\?: CurrentUser \| null/);
  assert.match(contractsView, /onLoginRequired: \(\) => void/);
  assert.match(contractsView, /Log in to set destination/);
  assert.match(contractsView, /currentUser \?/);
});

test('sidebar main navigation follows the requested workflow order', () => {
  const controlPanel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');
  const navStart = controlPanel.indexOf('<div className="view-nav');
  const navEnd = controlPanel.indexOf('</div>', navStart);
  const navBlock = controlPanel.slice(navStart, navEnd);
  const labels = Array.from(navBlock.matchAll(/>\s*([A-Za-z0-9 ]+)\s*<\/button>/g), match => match[1]);

  assert.deepEqual(labels, ['Pilots', 'Skills', 'Fleet', 'Fits', 'Fits v2', 'Assets', 'Market', 'Contracts', 'Industry', 'Planets']);
  assert.match(navBlock, /view-nav-10/);
});
