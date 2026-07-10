import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getShipLayout, resolveItemByName, resolveShipByName, searchFitShips } from './metadata.ts';

describe('fit metadata', () => {
  it('resolves provided example ships and items', () => {
    assert.equal(resolveShipByName('Naglfar')?.typeId, 19722);
    assert.equal(resolveShipByName('Archon')?.typeId, 23757);
    assert.equal(resolveItemByName('Republic Fleet Gyrostabilizer')?.name, 'Republic Fleet Gyrostabilizer');
    assert.equal(searchFitShips('nag', 5).some(ship => ship.name === 'Naglfar'), true);
  });

  it('reads ship slots from dogma attributes', () => {
    assert.deepEqual(getShipLayout(19722), {
      shipTypeId: 19722,
      shipName: 'Naglfar',
      highSlots: 5,
      midSlots: 7,
      lowSlots: 5,
      rigSlots: 3,
      serviceSlots: 0,
      subsystemSlots: 0,
      warnings: [],
    });
    assert.equal(getShipLayout(35832).serviceSlots, 3);
    assert.equal(getShipLayout(29984).subsystemSlots, 5);
  });
});
