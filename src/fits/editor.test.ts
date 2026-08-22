import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFitsV2EditorDocument, parseFitsV2EditorDocument, parseSerializedFitsV2EditorDocument } from './editor.ts';

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
