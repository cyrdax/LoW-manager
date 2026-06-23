import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateIndustryQuote, skillPointsForLevel, type IndustryBlueprint } from './calculator.ts';

const rifter: IndustryBlueprint = {
  blueprintId: 691,
  blueprintName: 'Rifter Blueprint',
  productTypeId: 587,
  productName: 'Rifter',
  productQuantity: 1,
  baseTimeSeconds: 6000,
  materials: [
    { typeId: 34, name: 'Tritanium', quantity: 32000 },
    { typeId: 35, name: 'Pyerite', quantity: 6000 },
  ],
  requiredSkills: [
    { skillId: 3380, name: 'Industry', level: 1, rank: 1 },
  ],
};

test('skillPointsForLevel matches EVE rank-based thresholds', () => {
  assert.equal(skillPointsForLevel(1, 0), 0);
  assert.equal(skillPointsForLevel(1, 1), 250);
  assert.equal(skillPointsForLevel(1, 5), 256000);
  assert.equal(skillPointsForLevel(2, 5), 512000);
});

test('calculateIndustryQuote applies ME to total material quantity and rounds up', () => {
  const quote = calculateIndustryQuote({
    blueprint: rifter,
    runs: 3,
    me: 10,
    te: 0,
    characterId: 'max',
    pilot: {
      kind: 'max',
      skillLevels: new Map([[3380, 5], [3388, 5]]),
      skillpoints: new Map(),
    },
  });

  assert.equal(quote.materials[0].baseQuantity, 96000);
  assert.equal(quote.materials[0].adjustedQuantity, 86400);
  assert.equal(quote.materials[1].baseQuantity, 18000);
  assert.equal(quote.materials[1].adjustedQuantity, 16200);
});

test('calculateIndustryQuote applies TE plus Industry and Advanced Industry time reductions', () => {
  const quote = calculateIndustryQuote({
    blueprint: rifter,
    runs: 2,
    me: 0,
    te: 20,
    characterId: 'max',
    pilot: {
      kind: 'max',
      skillLevels: new Map([[3380, 5], [3388, 5]]),
      skillpoints: new Map(),
    },
  });

  assert.equal(quote.time.perRunSeconds, Math.ceil(6000 * 0.8 * 0.8 * 0.85));
  assert.equal(quote.time.adjustedSeconds, Math.ceil(6000 * 0.8 * 0.8 * 0.85) * 2);
});

test('calculateIndustryQuote reports skill gaps for real pilots', () => {
  const quote = calculateIndustryQuote({
    blueprint: rifter,
    runs: 1,
    me: 0,
    te: 0,
    characterId: 123,
    pilot: {
      kind: 'character',
      skillLevels: new Map([[3380, 0], [3388, 0]]),
      skillpoints: new Map([[3380, 0]]),
    },
  });

  assert.equal(quote.inputs.characterId, 123);
  assert.equal(quote.skills[0].skillId, 3380);
  assert.equal(quote.skills[0].requiredLevel, 1);
  assert.equal(quote.skills[0].currentLevel, 0);
  assert.equal(quote.skills[0].spGap, 250);
  assert.equal(quote.totals.totalSpGap, 250);
  assert.equal(quote.totals.missingSkills, 1);
});
