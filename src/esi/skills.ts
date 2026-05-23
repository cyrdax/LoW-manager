import { esiGet } from './client.ts';

export interface SkillQueueEntry {
  skill_id: number;
  finished_level: number;
  queue_position: number;
  start_date?: string;
  finish_date?: string;
  training_start_sp?: number;
  level_end_sp?: number;
  level_start_sp?: number;
}

export const getSkillQueue = (id: number) => esiGet<SkillQueueEntry[]>(`/characters/${id}/skillqueue/`, id);

export interface SkillsResponse {
  total_sp: number;
  unallocated_sp?: number;
  skills: Array<{
    skill_id: number;
    trained_skill_level: number;
    active_skill_level: number;
    skillpoints_in_skill: number;
  }>;
}

export const getSkills = (id: number) => esiGet<SkillsResponse>(`/characters/${id}/skills/`, id);

// Skill type IDs we care about beyond aggregate SP.
export const SKILL_INTERPLANETARY_CONSOLIDATION = 2495;

export function skillLevel(skills: SkillsResponse, typeId: number): number {
  return skills.skills.find(s => s.skill_id === typeId)?.active_skill_level ?? 0;
}

export const getImplants = (id: number) => esiGet<number[]>(`/characters/${id}/implants/`, id);

export function currentlyTraining(queue: SkillQueueEntry[]): SkillQueueEntry | null {
  const now = Date.now();
  for (const e of queue) {
    if (!e.start_date || !e.finish_date) continue;
    const start = Date.parse(e.start_date);
    const finish = Date.parse(e.finish_date);
    if (start <= now && now < finish) return e;
  }
  return null;
}

/** Latest finish_date across the queue (ISO string), or "" if queue is empty. */
export function queueEndIso(queue: SkillQueueEntry[]): string {
  let max = '';
  for (const e of queue) {
    if (!e.finish_date) continue;
    if (e.finish_date > max) max = e.finish_date;
  }
  return max;
}
