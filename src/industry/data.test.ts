import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMasteryData } from '../skills/mastery-data.ts';

test('bundled industry data includes manufacturing blueprints', () => {
  const data = loadMasteryData();
  const rifter = data.industry?.blueprints['691'];

  assert.ok(rifter);
  assert.equal(rifter.blueprintName, 'Rifter Blueprint');
  assert.equal(rifter.productName, 'Rifter');
  assert.equal(rifter.baseTimeSeconds, 6000);
  assert.ok(rifter.materials.some(m => m.name === 'Tritanium' && m.quantity === 32000));
  assert.ok(rifter.requiredSkills.some(s => s.name === 'Industry' && s.level === 1));
});

test('bundled SDE data includes current command carrier hulls and blueprints', () => {
  const data = loadMasteryData();
  const simurghShip = data.ships['92823'];
  const simurghBlueprint = data.industry?.blueprints['94073'];

  assert.ok(simurghShip);
  assert.equal(simurghShip.name, 'Simurgh');
  assert.equal(simurghShip.groupName, 'Command Carrier');
  assert.ok(simurghShip.requiredSkills.some(s => s.skillId === 93983 && s.level >= 1));

  assert.ok(simurghBlueprint);
  assert.equal(simurghBlueprint.blueprintName, 'Simurgh Blueprint');
  assert.equal(simurghBlueprint.productTypeId, 92823);
  assert.equal(simurghBlueprint.productName, 'Simurgh');
  assert.ok(simurghBlueprint.materials.length > 0);
  assert.ok(simurghBlueprint.requiredSkills.some(s => s.name === 'Advanced Capital Ship Construction'));
});
