import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFitDraft } from './assignment.ts';
import { assertFitsV2EditorDocument, editorDocumentFromFitDraft, parseFitsV2EditorDocument, parseSerializedFitsV2EditorDocument, renderFitsV2EditorDocumentToEft } from './editor.ts';

const document = {
  version: 1,
  hull: { typeId: 24688, name: 'Rokh', groupId: 27, groupName: 'Battleship' },
  fitName: 'Rail Rokh',
  notes: 'line member fit',
  skillProfile: { kind: 'all-v', characterId: null, name: 'All V' },
  items: [
    {
      editorItemId: 'high-0',
      typeId: 2048,
      name: '425mm Railgun II',
      role: 'high',
      quantity: 1,
      slotIndex: 0,
      state: 'active',
      chargeTypeId: 230,
      chargeName: 'Spike L',
    },
  ],
};

test('Fits v2 editor document accepts the versioned editor payload', () => {
  const parsed = assertFitsV2EditorDocument(document);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.hull.name, 'Rokh');
  assert.equal(parsed.items[0].state, 'active');
});

test('Fits v2 editor document rejects invalid roles and unknown versions', () => {
  assert.equal(parseFitsV2EditorDocument({ ...document, version: 2 }), null);
  assert.equal(parseFitsV2EditorDocument({ ...document, items: [{ ...document.items[0], role: 'made-up' }] }), null);
});

test('serialized Fits v2 editor document round trips through JSON', () => {
  const parsed = parseSerializedFitsV2EditorDocument(JSON.stringify(document));
  assert.equal(parsed?.fitName, 'Rail Rokh');
  assert.equal(parsed?.items[0].chargeName, 'Spike L');
});

test('Fits v2 editor document converts from legacy EFT drafts and exports EFT', () => {
  const draft = buildFitDraft([
    '[Archon, Fabricator]',
    'Drone Damage Amplifier II',
    '',
    'Omnidirectional Tracking Link II, Optimal Range Script',
    '',
    'Integrated Sensor Array',
    '',
    'Capital Auxiliary Nano Pump I',
    '',
    'Equite II x12',
  ].join('\n'));

  const converted = editorDocumentFromFitDraft(draft);
  assert.equal(converted.hull.name, 'Archon');
  assert.equal(converted.items.some(item => item.name === 'Omnidirectional Tracking Link II' && item.chargeName === 'Optimal Range Script'), true);
  assert.equal(converted.items.find(item => item.name === 'Equite II')?.quantity, 12);

  const eft = renderFitsV2EditorDocumentToEft(converted);
  assert.match(eft, /^\[Archon, Fabricator\]/);
  assert.match(eft, /Omnidirectional Tracking Link II, Optimal Range Script/);
  assert.match(eft, /Equite II x12/);
});
