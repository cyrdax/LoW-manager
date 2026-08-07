import type { SkillQueueEntry, SkillsResponse } from '../esi/skills.ts';

export type CloneState = 'alpha-likely' | 'omega-likely' | 'unknown' | 'missing-skill-scope';

export interface CloneStateResult {
  cloneState: CloneState;
  cloneStateReason: string;
}

const ALPHA_QUEUE_LIMIT_MS = 24 * 60 * 60 * 1000;

export function inferCloneState(input: {
  hasSkillsScope: boolean;
  skills: SkillsResponse | null;
  skillQueue: SkillQueueEntry[] | null;
  nowMs?: number;
}): CloneStateResult {
  if (!input.hasSkillsScope) {
    return {
      cloneState: 'missing-skill-scope',
      cloneStateReason: 'Re-auth this pilot with the read skills scope to infer Alpha or Omega state.',
    };
  }

  if (!input.skills) {
    return {
      cloneState: 'unknown',
      cloneStateReason: 'Waiting for cached skill data before inferring clone state.',
    };
  }

  const inactiveSkillCount = input.skills.skills.filter(skill => skill.active_skill_level < skill.trained_skill_level).length;
  if (inactiveSkillCount > 0) {
    return {
      cloneState: 'alpha-likely',
      cloneStateReason: `${inactiveSkillCount} inactive Omega-trained skill${inactiveSkillCount === 1 ? '' : 's'} found.`,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const queueEndMs = latestQueueFinishMs(input.skillQueue ?? []);
  if (queueEndMs != null && queueEndMs - nowMs > ALPHA_QUEUE_LIMIT_MS) {
    return {
      cloneState: 'omega-likely',
      cloneStateReason: 'Skill queue extends more than 24 hours, which Alpha queues cannot do.',
    };
  }

  return {
    cloneState: 'unknown',
    cloneStateReason: 'No inactive skills or long queue detected; ESI does not expose subscription state directly.',
  };
}

function latestQueueFinishMs(queue: SkillQueueEntry[]): number | null {
  let latest: number | null = null;
  for (const entry of queue) {
    if (!entry.finish_date) continue;
    const finishMs = Date.parse(entry.finish_date);
    if (!Number.isFinite(finishMs)) continue;
    if (latest == null || finishMs > latest) latest = finishMs;
  }
  return latest;
}
