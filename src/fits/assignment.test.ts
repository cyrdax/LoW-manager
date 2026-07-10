import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFitDraft } from './assignment.ts';

describe('fit assignment', () => {
  it('assigns EFT sections to low, mid, high, rig, and extras with placeholders available', () => {
    const draft = buildFitDraft(`[Naglfar, Simulated Naglfar Fitting]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Tracking Enhancer II
Tracking Enhancer II
Capacitor Power Relay II

Capital Clarity Ward Enduring Shield Booster
Pithum C-Type Multispectrum Shield Hardener

Quad 800mm Repeating Cannon II
Siege Module II

Capital Semiconductor Memory Cell I

Hail XL x4057`);
    assert.equal(draft.ship?.name, 'Naglfar');
    assert.equal(draft.layout?.lowSlots, 5);
    assert.equal(draft.sections.low.items.length, 5);
    assert.equal(draft.sections.mid.items.length, 2);
    assert.equal(draft.sections.high.items.length, 2);
    assert.equal(draft.sections.rig.items.length, 1);
    assert.equal(draft.sections.extras.items.some(item => item.inputName === 'Hail XL'), true);
  });

  it('classifies Archon fighters and drones outside fitting slots', () => {
    const draft = buildFitDraft(`[Archon, Cheap Drones]

Drone Damage Amplifier II

Capital Cap Battery II

Integrated Sensor Array

Capital Thermal Armor Reinforcer I

Hobgoblin II x12
Templar II x6`);
    assert.equal(draft.sections.droneBay.items.some(item => item.inputName === 'Hobgoblin II'), true);
    assert.equal(draft.sections.fighterBay.items.some(item => item.inputName === 'Templar II'), true);
  });

  it('flags unmatched and over-slot rows without dropping them', () => {
    const draft = buildFitDraft(`[Naglfar, Bad]
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Republic Fleet Gyrostabilizer
Definitely Not A Real Module`);
    assert.equal(draft.warnings.some(w => w.code === 'over-slot'), true);
    assert.equal(draft.warnings.some(w => w.code === 'unmatched-item'), true);
    assert.equal(draft.sections.unmatched.items[0].inputName, 'Definitely Not A Real Module');
  });
});
