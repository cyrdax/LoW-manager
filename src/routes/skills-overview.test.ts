import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCharacterSkillsOverview, buildSkillComparison } from './skills.ts';
import type { MasteryData } from '../skills/mastery-data.ts';
import type { CharacterRow } from '../types.ts';

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

function pilot(id: number, name: string): CharacterRow {
  return {
    character_id: id,
    user_id: 'user-a',
    character_name: name,
    owner_hash: '',
    scopes: '',
    refresh_token: '',
    access_token: null,
    access_token_expires_at: null,
    added_at: 0,
    needs_reauth: 0,
    is_boss: 0,
  };
}

test('buildSkillComparison searches matching skills across all owned pilots', () => {
  const result = buildSkillComparison(masteryData, 'gunn', [
    pilot(101, 'Alpha'),
    pilot(202, 'Bravo'),
    pilot(303, 'Charlie'),
  ], characterId => {
    if (characterId === 101) {
      return {
        total_sp: 1_000_000,
        skills: [
          { skill_id: 3300, trained_skill_level: 5, active_skill_level: 5, skillpoints_in_skill: 256_000 },
        ],
      };
    }
    if (characterId === 202) {
      return {
        total_sp: 500_000,
        skills: [
          { skill_id: 3300, trained_skill_level: 4, active_skill_level: 3, skillpoints_in_skill: 8_000 },
        ],
      };
    }
    return null;
  });

  assert.equal(result.query, 'gunn');
  assert.equal(result.pilotCount, 3);
  assert.equal(result.cachedPilotCount, 2);
  assert.deepEqual(result.matches.map(match => match.name), ['Gunnery']);
  assert.deepEqual(result.matches[0].pilots.map(row => ({
    name: row.characterName,
    active: row.activeSkillLevel,
    trained: row.trainedSkillLevel,
    available: row.skillsAvailable,
  })), [
    { name: 'Alpha', active: 5, trained: 5, available: true },
    { name: 'Bravo', active: 3, trained: 4, available: true },
    { name: 'Charlie', active: null, trained: null, available: false },
  ]);
});

test('buildSkillComparison matches partial skill names', () => {
  const result = buildSkillComparison(masteryData, 'hybrid', [
    pilot(101, 'Alpha'),
  ], () => ({
    total_sp: 1_000_000,
    skills: [
      { skill_id: 3301, trained_skill_level: 4, active_skill_level: 4, skillpoints_in_skill: 45_255 },
    ],
  }));

  assert.deepEqual(result.matches.map(match => match.name), ['Small Hybrid Turret']);
  assert.equal(result.matches[0].pilots[0].activeSkillLevel, 4);
});
