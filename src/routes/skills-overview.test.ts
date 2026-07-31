import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCharacterSkillsOverview } from './skills.ts';
import type { MasteryData } from '../skills/mastery-data.ts';

const masteryData = {
  _meta: {
    built_at: '',
    sde_etag: null,
    sde_last_modified: null,
    sde_url: '',
    counts: { ships: 0, certificates: 0, skills: 3 },
  },
  ships: {},
  items: {},
  certificates: {},
  skills: {
    '3300': { name: 'Gunnery', rank: 1, groupId: 255, groupName: 'Gunnery', primary: 167, secondary: 168, requiredSkills: [] },
    '3301': { name: 'Small Hybrid Turret', rank: 1, groupId: 255, groupName: 'Gunnery', primary: 167, secondary: 168, requiredSkills: [] },
    '3380': { name: 'Industry', rank: 1, groupId: 268, groupName: 'Industry', primary: 166, secondary: 165, requiredSkills: [] },
  },
} satisfies MasteryData;

test('buildCharacterSkillsOverview groups trained skills and orders queue entries', () => {
  const overview = buildCharacterSkillsOverview(masteryData, {
    total_sp: 1_500_000,
    unallocated_sp: 12_345,
    skills: [
      { skill_id: 3380, trained_skill_level: 4, active_skill_level: 4, skillpoints_in_skill: 45_255 },
      { skill_id: 3301, trained_skill_level: 5, active_skill_level: 5, skillpoints_in_skill: 256_000 },
      { skill_id: 3300, trained_skill_level: 5, active_skill_level: 5, skillpoints_in_skill: 256_000 },
    ],
  }, [
    { skill_id: 3380, finished_level: 5, queue_position: 2, finish_date: '2026-08-03T00:00:00Z' },
    { skill_id: 3301, finished_level: 5, queue_position: 1, finish_date: '2026-08-01T00:00:00Z' },
  ]);

  assert.equal(overview.totals.totalSp, 1_500_000);
  assert.equal(overview.totals.trainedSkills, 3);
  assert.equal(overview.totals.queueLength, 2);
  assert.deepEqual(overview.groups.map(group => group.groupName), ['Gunnery', 'Industry']);
  assert.deepEqual(overview.groups[0].skills.map(skill => skill.name), ['Gunnery', 'Small Hybrid Turret']);
  assert.deepEqual(overview.queue.map(entry => entry.name), ['Small Hybrid Turret', 'Industry']);
});
