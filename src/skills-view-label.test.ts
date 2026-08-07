import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPilotSkillOptionLabel,
  formatSkillQueueRemainingLabel,
  sortSkillPilots,
} from '../web/src/components/SkillsView.tsx';
import type { CharacterStatus } from '../web/src/api.ts';

function character(overrides: Partial<CharacterStatus>): CharacterStatus {
  return {
    characterId: 1,
    name: 'Wayne Kerr',
    corporationId: null,
    corporationName: null,
    corporationTicker: 'LOW',
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
    ...overrides,
  };
}

test('skills pilot option label includes queue time remaining', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const queueEnd = '2026-08-03T04:05:00Z';

  assert.equal(formatSkillQueueRemainingLabel(queueEnd, now), '2d 4h 5m left');
  assert.equal(
    formatPilotSkillOptionLabel(character({ trainingQueueEnd: queueEnd }), now),
    'Wayne Kerr [LOW] - 2d 4h 5m left',
  );
});

test('skills pilot option label distinguishes empty and unknown queues', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');

  assert.equal(formatSkillQueueRemainingLabel('', now), 'queue empty');
  assert.equal(formatSkillQueueRemainingLabel(null, now), 'queue unknown');
  assert.equal(
    formatPilotSkillOptionLabel(character({ corporationTicker: null, trainingQueueEnd: '' }), now),
    'Wayne Kerr - queue empty',
  );
});

test('skills pilot dropdown can sort alphabetically or by shortest queue', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const chars = [
    character({ characterId: 1, name: 'Charlie', trainingQueueEnd: null }),
    character({ characterId: 2, name: 'Bravo', trainingQueueEnd: '2026-08-04T00:00:00Z' }),
    character({ characterId: 3, name: 'Alpha', trainingQueueEnd: '' }),
    character({ characterId: 4, name: 'Delta', trainingQueueEnd: '2026-08-02T00:00:00Z' }),
  ];

  assert.deepEqual(sortSkillPilots(chars, 'alpha', now).map(c => c.name), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(sortSkillPilots(chars, 'queue', now).map(c => c.name), ['Alpha', 'Delta', 'Bravo', 'Charlie']);
  assert.deepEqual(chars.map(c => c.name), ['Charlie', 'Bravo', 'Alpha', 'Delta']);
});
