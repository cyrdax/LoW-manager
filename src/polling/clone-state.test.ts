import assert from 'node:assert/strict';
import test from 'node:test';
import { inferCloneState } from './clone-state.ts';
import type { SkillQueueEntry, SkillsResponse } from '../esi/skills.ts';

function skills(...rows: SkillsResponse['skills']): SkillsResponse {
  return { total_sp: rows.reduce((sum, row) => sum + row.skillpoints_in_skill, 0), skills: rows };
}

function queue(finishDate: string): SkillQueueEntry[] {
  return [{ skill_id: 1, finished_level: 1, queue_position: 0, finish_date: finishDate }];
}

test('clone-state inference flags likely alpha when trained skills are inactive', () => {
  const result = inferCloneState({
    hasSkillsScope: true,
    skills: skills({ skill_id: 1, trained_skill_level: 5, active_skill_level: 4, skillpoints_in_skill: 256000 }),
    skillQueue: [],
    nowMs: Date.parse('2026-08-07T12:00:00.000Z'),
  });

  assert.equal(result.cloneState, 'alpha-likely');
  assert.match(result.cloneStateReason, /inactive omega-trained/i);
});

test('clone-state inference flags likely omega when skill queue extends past alpha queue limit', () => {
  const result = inferCloneState({
    hasSkillsScope: true,
    skills: skills({ skill_id: 1, trained_skill_level: 5, active_skill_level: 5, skillpoints_in_skill: 256000 }),
    skillQueue: queue('2026-08-09T13:00:00.000Z'),
    nowMs: Date.parse('2026-08-07T12:00:00.000Z'),
  });

  assert.equal(result.cloneState, 'omega-likely');
  assert.match(result.cloneStateReason, /more than 24 hours/i);
});

test('clone-state inference reports missing scope when skill data is unavailable', () => {
  const result = inferCloneState({
    hasSkillsScope: false,
    skills: null,
    skillQueue: null,
    nowMs: Date.parse('2026-08-07T12:00:00.000Z'),
  });

  assert.equal(result.cloneState, 'missing-skill-scope');
  assert.match(result.cloneStateReason, /read skills scope/i);
});
