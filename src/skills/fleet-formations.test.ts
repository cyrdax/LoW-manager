import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillComparison } from '../routes/skills.ts';
import { loadMasteryData } from './mastery-data.ts';

test('current skill catalog exposes Fleet Formations to cross-pilot search', () => {
  const result = buildSkillComparison(loadMasteryData(), 'fleet formations', [], () => null);

  assert.deepEqual(result.matches.map(match => ({
    skillId: match.skillId,
    name: match.name,
    groupName: match.groupName,
  })), [{
    skillId: 57_317,
    name: 'Fleet Formations',
    groupName: 'Fleet Support',
  }]);
});
