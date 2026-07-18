import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('assets view is wired into navigation between fits and market', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const panel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');

  assert.match(app, /import \{ AssetsView \}/);
  assert.match(app, /view === 'assets'/);
  assert.match(panel, /type View = .*'assets'/s);
  assert.match(panel, />Fits<\/button>[\s\S]*view === 'assets'[\s\S]*>Assets<\/button>[\s\S]*>Market<\/button>/);
});

test('assets api helpers and component expose dashboard refresh search and expandable tree controls', () => {
  const api = readFileSync(resolve('web/src/api.ts'), 'utf8');
  const view = readFileSync(resolve('web/src/components/AssetsView.tsx'), 'utf8');

  assert.match(api, /export interface AssetDashboard/);
  assert.match(api, /export async function fetchAssets/);
  assert.match(api, /export async function refreshAllAssets/);
  assert.match(api, /export async function refreshPilotAssets/);

  assert.match(view, /Refresh All/);
  assert.match(view, /Search assets/);
  assert.match(view, /All assets/);
  assert.match(view, /expandedPilots/);
  assert.match(view, /expandedLocations/);
  assert.match(view, /expandedAssets/);
});
