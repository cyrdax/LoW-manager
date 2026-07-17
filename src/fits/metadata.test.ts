import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { getShipLayout, parseCsvRows, resolveItemByName, resolveItemByTypeId, resolveShipByName, searchFitShips } from './metadata.ts';

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

  it('streams csv rows without materializing the whole file', () => {
    assert.deepEqual([...parseCsvRows('id,name\n1,"Alpha, Beta"\n2,"Quoted ""Name"""\n')], [
      ['id', 'name'],
      ['1', 'Alpha, Beta'],
      ['2', 'Quoted "Name"'],
    ]);

    const source = readFileSync(resolve('src/fits/metadata.ts'), 'utf8');
    assert.match(source, /function readCsvRows\(name: string\): Iterable<string\[\]>/);
    assert.doesNotMatch(source, /function readCsv\(name: string\): string\[\]\[\]/);
  });

  it('resolves item metadata by type id for asset imports', () => {
    const tritanium = resolveItemByTypeId(34);
    assert.equal(tritanium?.name, 'Tritanium');
    assert.equal(tritanium?.groupName, 'Mineral');
  });

  it('indexes every published Fuzzwork item ID even when names collide', () => {
    const skin = resolveItemByTypeId(42162);
    assert.equal(skin?.name, 'Catalyst Serpentis SKIN');
    assert.equal(skin?.typeId, 42162);
  });
});
