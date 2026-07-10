import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEftFit, renderEftFit } from './parser.ts';

const naglfar = `[Naglfar, Simulated Naglfar Fitting]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer

Quad 800mm Repeating Cannon II
Siege Module II
Armor Command Burst II, Rapid Repair Charge

Hail XL x4,057
Barrage XL x9022`;

describe('EFT parser', () => {
  it('parses one header, duplicate modules, sections, loaded charges, and comma quantities', () => {
    const parsed = parseEftFit(naglfar);
    assert.equal(parsed.header.shipName, 'Naglfar');
    assert.equal(parsed.header.fitName, 'Simulated Naglfar Fitting');
    assert.equal(parsed.lines.filter(line => line.itemName === 'Republic Fleet Gyrostabilizer').length, 2);
    assert.deepEqual(parsed.lines.find(line => line.itemName === 'Armor Command Burst II')?.loadedChargeName, 'Rapid Repair Charge');
    assert.equal(parsed.lines.find(line => line.itemName === 'Hail XL')?.quantity, 4057);
    assert.equal(parsed.sections.length, 3);
  });

  it('rejects multiple headers', () => {
    assert.throws(() => parseEftFit('[Naglfar, A]\n[Archon, B]'), /one fit at a time/i);
  });

  it('renders normalized EFT with repeated fitted modules and stacked cargo', () => {
    const parsed = parseEftFit(naglfar);
    const rendered = renderEftFit({
      shipName: parsed.header.shipName,
      fitName: parsed.header.fitName,
      lines: parsed.lines,
    });
    assert.match(rendered, /^\[Naglfar, Simulated Naglfar Fitting\]/);
    assert.match(rendered, /Hail XL x4057/);
    assert.match(rendered, /Armor Command Burst II, Rapid Repair Charge/);
  });
});
