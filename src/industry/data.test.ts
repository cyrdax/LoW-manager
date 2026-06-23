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
