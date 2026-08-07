import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  characterRowStatusItems,
  characterRowTooltipText,
  characterRowVisualState,
  pilotRowTooltipPosition,
} from '../web/src/components/CharacterCard.tsx';
import type { CharacterStatus } from '../web/src/api.ts';

const baseCharacter: CharacterStatus = {
  characterId: 123,
  name: 'Wayne Kerr',
  corporationId: null,
  corporationName: null,
  corporationTicker: null,
  portraitUrl: '',
  online: null,
  lastLogin: null,
  lastLogout: null,
  locationSystemId: null,
  locationSystemName: null,
  locationStationId: null,
  locationStationName: null,
  locationStructureId: null,
  shipTypeId: null,
  shipTypeName: null,
  shipName: null,
  walletBalance: null,
  trainingSkillId: null,
  trainingSkillName: null,
  trainingLevel: null,
  trainingFinishDate: null,
  trainingQueueEnd: null,
  totalSp: null,
  unallocatedSp: null,
  implantNames: [],
  interplanetaryConsolidation: null,
  colonies: [],
  nextPiExpiry: null,
  hasIdlePi: false,
  fleetId: null,
  fleetRole: null,
  fleetWingId: null,
  fleetSquadId: null,
  isBoss: false,
  needsReauth: false,
  cloneState: 'unknown',
  cloneStateReason: 'No inactive skills or long queue detected; ESI does not expose subscription state directly.',
  updatedAt: 0,
};

test('character row status identifies brown non-Virtue implant rows', () => {
  const visual = characterRowVisualState({
    ...baseCharacter,
    implantNames: ['High-grade Ascendancy Alpha', 'AU-79'],
  }, null, Date.now());

  assert.equal(visual.hasWrongImplants, true);
  assert.equal(visual.hasVirtue, false);

  const items = characterRowStatusItems(visual);
  assert.ok(items.some(item => item.label === 'Brown row' && /non-Virtue implant pod/i.test(item.detail)));
});

test('character row tooltip explains only statuses active for the row', () => {
  const now = Date.parse('2026-08-02T12:00:00.000Z');
  const visual = characterRowVisualState({
    ...baseCharacter,
    isBoss: true,
    trainingQueueEnd: '2026-08-05T12:00:00.000Z',
    implantNames: ['Low-grade Virtue Alpha'],
  }, 999, now);

  const text = characterRowTooltipText(visual);

  assert.match(text, /Blue row: Fleet boss/i);
  assert.match(text, /Green row: Virtue pod/i);
  assert.match(text, /Red outline: Skill queue/i);
  assert.doesNotMatch(text, /Brown row/i);
});

test('character row status explains boss fleet membership pills', () => {
  const visual = characterRowVisualState({
    ...baseCharacter,
    fleetId: 456,
  }, 999, Date.now());

  const text = characterRowTooltipText(visual);

  assert.match(text, /Amber X: Pilot is not in the boss fleet/i);
});

test('pilot row tooltip positions near the pointer and clamps to viewport', () => {
  assert.deepEqual(
    pilotRowTooltipPosition({ x: 120, y: 140 }, { width: 1000, height: 800 }),
    { left: 132, top: 152 },
  );

  assert.deepEqual(
    pilotRowTooltipPosition({ x: 980, y: 780 }, { width: 1000, height: 800 }),
    { left: 568, top: 628 },
  );
});

test('character card exposes inferred clone state badge copy', () => {
  const source = readFileSync(new URL('../web/src/components/CharacterCard.tsx', import.meta.url), 'utf8');

  assert.match(source, /cloneStateLabel/);
  assert.match(source, /Alpha\?/);
  assert.match(source, /Omega\?/);
  assert.match(source, /title=\{c\.cloneStateReason\}/);
});
