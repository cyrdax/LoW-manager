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

test('pilot waypoint command uses an explicit button and modal results', () => {
  const pilotTools = readFileSync(resolve('web/src/components/PilotTools.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  const keyHandlerStart = pilotTools.indexOf('const onKeyDown');
  const keyHandlerEnd = pilotTools.indexOf('return (', keyHandlerStart);
  const keyHandler = pilotTools.slice(keyHandlerStart, keyHandlerEnd);

  assert.match(pilotTools, /className="primary ap-set-btn"[\s\S]*Set waypoint[\s\S]*<\/button>/);
  assert.match(pilotTools, /selectedSystem/);
  assert.match(pilotTools, /waypoint-results-modal/);
  assert.doesNotMatch(keyHandler, /pick\(/);
  assert.match(styles, /\.waypoint-results-modal/);
  assert.match(styles, /\.waypoint-results-list/);
});

test('fleet invite command results render in a modal instead of the widget body', () => {
  const fleetInviteWidget = readFileSync(resolve('web/src/components/FleetInviteWidget.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(fleetInviteWidget, /fleet-results-modal/);
  assert.match(fleetInviteWidget, /fleet-results-list/);
  assert.doesNotMatch(fleetInviteWidget, /className="tool-widget-results"/);
  assert.match(styles, /\.fleet-results-modal/);
  assert.match(styles, /\.fleet-results-list/);
});

test('fleet invite widget is collapsible with page-specific defaults', () => {
  const app = readFileSync(resolve('web/src/App.tsx'), 'utf8');
  const fleetView = readFileSync(resolve('web/src/components/FleetView.tsx'), 'utf8');
  const fleetInviteWidget = readFileSync(resolve('web/src/components/FleetInviteWidget.tsx'), 'utf8');
  const pilotTools = readFileSync(resolve('web/src/components/PilotTools.tsx'), 'utf8');
  const styles = readFileSync(resolve('web/src/styles.css'), 'utf8');

  assert.match(app, /<FleetInviteWidget[\s\S]*defaultExpanded={true}/);
  assert.match(fleetView, /<FleetInviteWidget[\s\S]*defaultExpanded={false}/);
  assert.match(fleetInviteWidget, /defaultExpanded/);
  assert.match(fleetInviteWidget, /aria-expanded={expanded}/);
  assert.match(fleetInviteWidget, /fleet-invite-body/);
  assert.match(styles, /\.fleet-invite-toggle/);
  assert.match(styles, /\.fleet-invite-widget\.collapsed/);
  assert.match(app, /pilotWidgetsExpanded/);
  assert.match(app, /<PilotTools[\s\S]*expanded={pilotWidgetsExpanded}/);
  assert.match(app, /<FleetInviteWidget[\s\S]*expanded={pilotWidgetsExpanded}[\s\S]*onExpandedChange={setPilotWidgetsExpanded}/);
  assert.match(pilotTools, /expanded/);
  assert.match(pilotTools, /pilot-tools-body/);
  assert.match(styles, /\.pilot-tools\.collapsed/);
});
