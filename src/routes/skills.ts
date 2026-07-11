import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  requireOwnedCharacter,
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
  type OwnsCharacter,
} from '../auth/pilot-access.ts';
import { openInformationWindow, openMarketDetailsWindow } from '../esi/ui.ts';
import { getCharacterAttributes, getCharacterSkills } from '../polling/scheduler.ts';
import { loadMasteryData, type MasteryData, type MasteryItem, type MasteryShip } from '../skills/mastery-data.ts';
import { createSavedSkillPlanStore, type SavedSkillPlanStore } from '../skills/saved-plans-store.ts';
import { trainingSecondsForSp, type CharacterAttributes } from '../skills/training-time.ts';

// Standard EVE SP requirement per skill level (multiplied by skill rank).
// Level index 0..5 — index 0 = "untrained", values 1..5 = SP needed for that level.
const SP_PER_LEVEL_MULT = [0, 250, 1414.21, 8000, 45254.83, 256000];

function spForLevel(level: number, rank: number): number {
  if (level <= 0) return 0;
  if (level > 5) level = 5;
  return Math.round(SP_PER_LEVEL_MULT[level] * rank);
}

interface PlannedSkill {
  skillId: number;
  name: string;
  rank: number;
  currentLevel: number;
  currentSp: number;
  targetLevel: number;
  targetSp: number;
  spGap: number;
  trainingSeconds: number;
  // Why this skill is in the plan — preferred sources first.
  sources: Array<{ kind: 'ship-prereq' } | { kind: 'mastery'; certId: number; certName: string }>;
}

function unionTargets(target: Map<number, { level: number; sources: PlannedSkill['sources'] }>,
                     skillId: number, level: number, source: PlannedSkill['sources'][number]) {
  const existing = target.get(skillId);
  if (!existing) {
    target.set(skillId, { level, sources: [source] });
    return;
  }
  // Take the max requirement; merge sources.
  if (level > existing.level) existing.level = level;
  // Avoid duplicate sources for the same cert.
  const dup = existing.sources.some(s =>
    s.kind === source.kind && (s.kind !== 'mastery' || (source.kind === 'mastery' && s.certId === source.certId)),
  );
  if (!dup) existing.sources.push(source);
}

function buildPlan(
  data: MasteryData,
  ship: MasteryShip,
  masteryLevel: number,
  charSkills: ReturnType<typeof getCharacterSkills>,
  attributes: CharacterAttributes | null,
) {
  const targets = new Map<number, { level: number; sources: PlannedSkill['sources'] }>();

  // Ship's direct prerequisites are always part of the plan (level 0 = untargeted but listed).
  for (const r of ship.requiredSkills) {
    if (r.level > 0) unionTargets(targets, r.skillId, r.level, { kind: 'ship-prereq' });
  }

  // Mastery cert skill targets at the chosen level (1..5 → index 0..4).
  if (masteryLevel >= 1 && masteryLevel <= 5) {
    const certIds = ship.masteries[masteryLevel - 1] ?? [];
    for (const cid of certIds) {
      const cert = data.certificates[String(cid)];
      if (!cert) continue;
      for (const s of cert.skills) {
        const required = s.levels[masteryLevel - 1] ?? 0;
        if (required <= 0) continue;
        unionTargets(targets, s.skillId, required, { kind: 'mastery', certId: cid, certName: cert.name });
      }
    }
  }

  // Resolve against the pilot's current skill levels + SP.
  const charSkillById = new Map<number, { level: number; sp: number }>();
  for (const s of charSkills?.skills ?? []) {
    charSkillById.set(s.skill_id, { level: s.active_skill_level, sp: s.skillpoints_in_skill });
  }

  const planned: PlannedSkill[] = [];
  for (const [skillId, { level, sources }] of targets) {
    const meta = data.skills[String(skillId)];
    const rank = meta?.rank ?? 1;
    const primary = meta?.primary ?? null;
    const secondary = meta?.secondary ?? null;
    const cur = charSkillById.get(skillId);
    const currentLevel = cur?.level ?? 0;
    const currentSp = cur?.sp ?? 0;
    const targetSp = spForLevel(level, rank);
    const spGap = Math.max(0, targetSp - currentSp);
    planned.push({
      skillId,
      name: meta?.name ?? `Skill ${skillId}`,
      rank,
      currentLevel,
      currentSp,
      targetLevel: level,
      targetSp,
      spGap,
      trainingSeconds: trainingSecondsForSp(spGap, primary, secondary, attributes),
      sources,
    });
  }

  // Sort: missing skills first (by gap desc), then satisfied (alphabetical).
  planned.sort((a, b) => {
    const aMet = a.currentLevel >= a.targetLevel;
    const bMet = b.currentLevel >= b.targetLevel;
    if (aMet !== bMet) return aMet ? 1 : -1;
    if (!aMet) return b.spGap - a.spGap;
    return a.name.localeCompare(b.name);
  });

  const totalSpGap = planned.reduce((n, s) => n + s.spGap, 0);
  const totalTrainingSeconds = planned.reduce((n, s) => n + s.trainingSeconds, 0);
  const skillsToTrain = planned.filter(s => s.currentLevel < s.targetLevel).length;
  const skillsMet = planned.length - skillsToTrain;

  return {
    ship: { id: 0, name: ship.name, groupName: ship.groupName },
    masteryLevel,
    skills: planned,
    totals: { totalSpGap, totalTrainingSeconds, skillsToTrain, skillsMet, totalSkills: planned.length },
  };
}

function buildItemPlan(
  data: MasteryData,
  item: MasteryItem,
  charSkills: ReturnType<typeof getCharacterSkills>,
  attributes: CharacterAttributes | null,
) {
  const targets = new Map<number, { level: number; sources: PlannedSkill['sources'] }>();
  for (const r of item.requiredSkills) {
    if (r.level > 0) unionTargets(targets, r.skillId, r.level, { kind: 'ship-prereq' });
  }

  const charSkillById = new Map<number, { level: number; sp: number }>();
  for (const s of charSkills?.skills ?? []) {
    charSkillById.set(s.skill_id, { level: s.active_skill_level, sp: s.skillpoints_in_skill });
  }

  const planned: PlannedSkill[] = [];
  for (const [skillId, { level, sources }] of targets) {
    const meta = data.skills[String(skillId)];
    const rank = meta?.rank ?? 1;
    const primary = meta?.primary ?? null;
    const secondary = meta?.secondary ?? null;
    const cur = charSkillById.get(skillId);
    const currentLevel = cur?.level ?? 0;
    const currentSp = cur?.sp ?? 0;
    const targetSp = spForLevel(level, rank);
    const spGap = Math.max(0, targetSp - currentSp);
    planned.push({
      skillId,
      name: meta?.name ?? `Skill ${skillId}`,
      rank,
      currentLevel,
      currentSp,
      targetLevel: level,
      targetSp,
      spGap,
      trainingSeconds: trainingSecondsForSp(spGap, primary, secondary, attributes),
      sources,
    });
  }

  planned.sort((a, b) => {
    const aMet = a.currentLevel >= a.targetLevel;
    const bMet = b.currentLevel >= b.targetLevel;
    if (aMet !== bMet) return aMet ? 1 : -1;
    if (!aMet) return b.spGap - a.spGap;
    return a.name.localeCompare(b.name);
  });

  const totalSpGap = planned.reduce((n, s) => n + s.spGap, 0);
  const totalTrainingSeconds = planned.reduce((n, s) => n + s.trainingSeconds, 0);
  const skillsToTrain = planned.filter(s => s.currentLevel < s.targetLevel).length;
  const skillsMet = planned.length - skillsToTrain;

  return { skills: planned, totals: { totalSpGap, totalTrainingSeconds, skillsToTrain, skillsMet, totalSkills: planned.length } };
}

export interface SkillRouteDeps {
  currentUser?: CurrentUserResolver;
  ownsCharacter?: OwnsCharacter;
  savedPlans?: SavedSkillPlanStore;
}

export function registerSkillsRoutes(app: FastifyInstance, deps: SkillRouteDeps = {}) {
  const currentUser = routeCurrentUser(deps);
  const owns = deps.ownsCharacter;
  const savedPlans = deps.savedPlans ?? createSavedSkillPlanStore();

  app.get('/api/skills/meta', async () => {
    const data = loadMasteryData();
    return { meta: data._meta };
  });

  app.get<{ Querystring: { q?: string } }>('/api/skills/ships', async (req) => {
    const data = loadMasteryData();
    const q = (req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) return [];
    const matches: Array<{ id: number; name: string; groupName: string }> = [];
    // Prefer prefix matches, then substring.
    const prefix: typeof matches = [];
    const substr: typeof matches = [];
    for (const [id, s] of Object.entries(data.ships)) {
      const lname = s.name.toLowerCase();
      if (lname.startsWith(q)) prefix.push({ id: Number(id), name: s.name, groupName: s.groupName });
      else if (lname.includes(q)) substr.push({ id: Number(id), name: s.name, groupName: s.groupName });
      if (prefix.length >= 20) break;
    }
    prefix.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    substr.sort((a, b) => a.name.localeCompare(b.name));
    return [...prefix, ...substr].slice(0, 20);
  });

  app.get<{ Querystring: { q?: string } }>('/api/skills/items', async (req) => {
    const data = loadMasteryData();
    const q = (req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) return [];
    const prefix: Array<{ id: number; name: string; groupName: string; categoryName: string }> = [];
    const substr: typeof prefix = [];
    for (const [id, it] of Object.entries(data.items)) {
      const lname = it.name.toLowerCase();
      const entry = { id: Number(id), name: it.name, groupName: it.groupName, categoryName: it.categoryName };
      if (lname.startsWith(q)) prefix.push(entry);
      else if (lname.includes(q)) substr.push(entry);
      if (prefix.length >= 30) break;
    }
    prefix.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    substr.sort((a, b) => a.name.localeCompare(b.name));
    return [...prefix, ...substr].slice(0, 25);
  });

  app.get<{ Params: { itemId: string } }>('/api/skills/item/:itemId', async (req, reply) => {
    const data = loadMasteryData();
    const item = data.items[req.params.itemId];
    if (!item) return reply.code(404).send({ error: 'item not found' });
    return { id: Number(req.params.itemId), ...item };
  });

  app.get<{ Querystring: { characterId?: string; itemId?: string } }>(
    '/api/skills/item-plan',
    async (req, reply) => {
      const data = loadMasteryData();
      const charId = Number(req.query.characterId);
      const itemId = Number(req.query.itemId);
      if (!Number.isFinite(charId) || !Number.isFinite(itemId)) {
        return reply.code(400).send({ error: 'characterId and itemId are required' });
      }
      const user = await requireUser(req, reply, currentUser);
      if (!user) return reply;
      if (!requireOwnedCharacter(user.id, charId, reply, owns)) return reply;
      const item = data.items[String(itemId)];
      if (!item) return reply.code(404).send({ error: 'item not found' });

      const charSkills = getCharacterSkills(charId);
      if (!charSkills) {
        return reply.code(409).send({ error: 'character skills not yet polled — try again in a moment' });
      }

      const result = buildItemPlan(data, item, charSkills, getCharacterAttributes(charId));
      return {
        ...result,
        item: {
          id: itemId,
          name: item.name,
          groupName: item.groupName,
          categoryName: item.categoryName,
        },
        characterId: charId,
        characterTotalSp: charSkills.total_sp,
      };
    },
  );

  app.get<{ Params: { shipId: string } }>('/api/skills/ship/:shipId', async (req, reply) => {
    const data = loadMasteryData();
    const ship = data.ships[req.params.shipId];
    if (!ship) return reply.code(404).send({ error: 'ship not found' });
    return {
      id: Number(req.params.shipId),
      ...ship,
    };
  });

  app.get<{ Querystring: { characterId?: string; shipId?: string; masteryLevel?: string } }>(
    '/api/skills/plan',
    async (req, reply) => {
      const data = loadMasteryData();
      const charId = Number(req.query.characterId);
      const shipId = Number(req.query.shipId);
      const masteryLevel = Number(req.query.masteryLevel ?? 0);
      if (!Number.isFinite(charId) || !Number.isFinite(shipId)) {
        return reply.code(400).send({ error: 'characterId and shipId are required' });
      }
      const user = await requireUser(req, reply, currentUser);
      if (!user) return reply;
      if (!requireOwnedCharacter(user.id, charId, reply, owns)) return reply;
      const ship = data.ships[String(shipId)];
      if (!ship) return reply.code(404).send({ error: 'ship not found' });

      const charSkills = getCharacterSkills(charId);
      if (!charSkills) {
        return reply.code(409).send({
          error: 'character skills not yet polled — try again in a moment',
        });
      }

      const result = buildPlan(data, ship, masteryLevel, charSkills, getCharacterAttributes(charId));
      return {
        ...result,
        ship: { id: shipId, name: ship.name, groupName: ship.groupName },
        characterId: charId,
        characterTotalSp: charSkills.total_sp,
      };
    },
  );

  app.get<{ Querystring: { characterId?: string } }>('/api/skills/plans', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const data = loadMasteryData();
    const charId = Number(req.query.characterId);
    if (Number.isFinite(charId) && !requireOwnedCharacter(user.id, charId, reply, owns)) return reply;
    const rows = savedPlans.list(user.id, Number.isFinite(charId) ? charId : undefined);
    return rows.map(r => {
      const ship = data.ships[String(r.ship_id)];
      return {
        id: r.id,
        characterId: r.character_id,
        shipId: r.ship_id,
        shipName: ship?.name ?? `Type ${r.ship_id}`,
        groupName: ship?.groupName ?? '',
        masteryLevel: r.mastery_level,
        label: r.label,
        savedAt: r.saved_at,
      };
    });
  });

  const savePlanSchema = z.object({
    character_id: z.number().int(),
    ship_id: z.number().int(),
    mastery_level: z.number().int().min(1).max(5),
    label: z.string().max(120).optional().nullable(),
  });
  app.post('/api/skills/plans', async (req, reply) => {
    const parsed = savePlanSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { character_id, ship_id, mastery_level, label } = parsed.data;
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    if (!requireOwnedCharacter(user.id, character_id, reply, owns)) return reply;
    savedPlans.save({
      userId: user.id,
      characterId: character_id,
      shipId: ship_id,
      masteryLevel: mastery_level,
      label,
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/skills/plans/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid id' });
    savedPlans.delete(user.id, id);
    return { ok: true };
  });

  const openWindowSchema = z.object({
    character_id: z.number().int(),
    type_id: z.number().int(),
    kind: z.enum(['info', 'market']),
  });
  app.post('/api/skills/open-window', async (req, reply) => {
    const parsed = openWindowSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { character_id, type_id, kind } = parsed.data;
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    if (!requireOwnedCharacter(user.id, character_id, reply, owns)) return reply;
    try {
      if (kind === 'info') await openInformationWindow(character_id, type_id);
      else await openMarketDetailsWindow(character_id, type_id);
      return { ok: true };
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      // 403 here usually means scope mismatch (token predates esi-ui.open_window.v1).
      // 5xx from CCP can mean the client isn't running or refused the popup.
      return reply.code(e.status ?? 500).send({ error: e.body ?? e.message ?? 'open-window failed' });
    }
  });

  app.get('/api/skills/sde-status', async () => {
    const data = loadMasteryData();
    const head = await fetch(data._meta.sde_url, { method: 'HEAD' }).catch(() => null);
    if (!head || !head.ok) {
      return { current: data._meta.sde_etag, latest: null, stale: false, reachable: false };
    }
    const latest = head.headers.get('etag');
    return {
      current: data._meta.sde_etag,
      latest,
      latestLastModified: head.headers.get('last-modified'),
      stale: !!latest && latest !== data._meta.sde_etag,
      reachable: true,
    };
  });
}
