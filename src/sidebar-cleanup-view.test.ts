import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('sidebar stays navigation-only while pilot and fleet tools live in content views', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const controlPanel = readFileSync(resolve('web/src/components/ControlPanel.tsx'), 'utf8');
  const fleetView = readFileSync(resolve('web/src/components/FleetView.tsx'), 'utf8');
  const pilotTools = readFileSync(resolve('web/src/components/PilotTools.tsx'), 'utf8');
  const fleetInviteWidget = readFileSync(resolve('web/src/components/FleetInviteWidget.tsx'), 'utf8');

  assert.doesNotMatch(controlPanel, /Add character/);
  assert.doesNotMatch(controlPanel, /Main pilot/);
  assert.doesNotMatch(controlPanel, /Invite selected/);
  assert.doesNotMatch(controlPanel, /Fleet boss/);

  assert.match(app, /<PilotTools/);
  assert.match(app, /<FleetInviteWidget/);
  assert.match(fleetView, /<FleetInviteWidget/);
  assert.match(pilotTools, /Add character/);
  assert.match(pilotTools, /Main pilot/);
  assert.match(fleetInviteWidget, /Invite selected/);
});

