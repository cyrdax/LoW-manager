import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMasteryData } from '../skills/mastery-data.ts';
import { calculateIndustryPlan } from './planner.ts';

test('calculateIndustryPlan builds a Simurgh from invention and recursive inputs', () => {
  const data = loadMasteryData();
  const blueprint = data.industry?.blueprints['94073'];
  assert.ok(blueprint);

  const plan = calculateIndustryPlan({
    data,
    blueprint,
    runs: 1,
    characterId: 123,
    pilot: {
      kind: 'character',
      skillLevels: new Map(),
      skillpoints: new Map(),
      attributes: {
        charisma: 19,
        intelligence: 20,
        memory: 20,
        perception: 20,
        willpower: 20,
      },
    },
    buildInputs: true,
    supportMe: 10,
    supportTe: 20,
    decryptorKey: 'none',
    bonuses: {
      manufacturingTimeBonus: 0,
      manufacturingMaterialBonus: 0,
      inventionTimeBonus: 0,
      copyingTimeBonus: 0,
      reactionTimeBonus: 0,
      reactionMaterialBonus: 0,
      jobFeeBonus: 0,
      facilityTax: 0,
    },
  });

  assert.equal(plan.target.productName, 'Simurgh');
  assert.ok(plan.invention);
  assert.equal(plan.invention.sourceBlueprintName, 'Chimera Blueprint');
  assert.ok(Math.abs(plan.invention.chance - 0.1965) < 0.0001);
  assert.equal(plan.assumptions.inventionOutput?.me, 2);
  assert.equal(plan.assumptions.inventionOutput?.te, 4);
  assert.ok(plan.jobs.some(j => j.activityName === 'Copying' && j.blueprintName === 'Chimera Blueprint'));
  assert.ok(plan.jobs.some(j => j.activityName === 'Invention' && j.productName === 'Simurgh Blueprint'));
  assert.ok(plan.jobs.some(j => j.activityName === 'Manufacturing' && j.productName === 'Simurgh'));
  assert.ok(plan.jobs.some(j => j.activityName === 'Manufacturing' && j.productName === 'Chimera'));
  assert.ok(plan.skills.some(s => s.name === 'Caldari Encryption Methods' && s.requiredLevel === 1));
  assert.ok(plan.skills.some(s => s.name === 'Hacking' && s.requiredLevel >= 2));
  assert.ok(plan.totals.jobSeconds > 0);
  assert.ok(plan.totals.skillTrainingSeconds > 0);
  assert.ok(plan.materials.raw.length > 0);
});
