import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  requireOwnedCharacter,
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
  type OwnsCharacter,
} from '../auth/pilot-access.ts';
import { getAdjustedPrices, getSystemCostIndex } from '../esi/industry.ts';
import { resolveSystem } from '../esi/universe.ts';
import { getCharacterAttributes, getCharacterSkills } from '../polling/scheduler.ts';
import { calculateIndustryQuote, type IndustryBlueprint, type IndustryPilotSkills } from '../industry/calculator.ts';
import { calculateIndustryPlan, DECRYPTORS, type IndustryPlanBonuses } from '../industry/planner.ts';
import { loadMasteryData, type IndustryBlueprintData, type MasteryData } from '../skills/mastery-data.ts';

const searchQuery = z.object({
  q: z.string().optional(),
});

const quoteQuery = z.object({
  blueprintId: z.coerce.number().int().positive(),
  characterId: z.string().min(1),
  runs: z.coerce.number().int().min(1).max(1_000_000).default(1),
  me: z.coerce.number().int().min(0).max(10).default(0),
  te: z.coerce.number().int().min(0).max(20).default(0),
});

const planQuery = z.object({
  blueprintId: z.coerce.number().int().positive(),
  characterId: z.string().min(1),
  runs: z.coerce.number().int().min(1).max(1_000_000).default(1),
  systemId: z.coerce.number().int().positive().optional(),
  buildInputs: z.coerce.boolean().default(true),
  supportMe: z.coerce.number().int().min(0).max(10).default(10),
  supportTe: z.coerce.number().int().min(0).max(20).default(20),
  decryptor: z.string().default('none'),
  manufacturingTimeBonus: z.coerce.number().min(0).max(100).default(0),
  manufacturingMaterialBonus: z.coerce.number().min(0).max(100).default(0),
  inventionTimeBonus: z.coerce.number().min(0).max(100).default(0),
  copyingTimeBonus: z.coerce.number().min(0).max(100).default(0),
  reactionTimeBonus: z.coerce.number().min(0).max(100).default(0),
  reactionMaterialBonus: z.coerce.number().min(0).max(100).default(0),
  jobFeeBonus: z.coerce.number().min(0).max(100).default(0),
  facilityTax: z.coerce.number().min(0).max(100).default(0),
});

const systemCostQuery = z.object({
  systemId: z.coerce.number().int().positive(),
});

function blueprints(): Record<string, IndustryBlueprintData> {
  return loadMasteryData().industry?.blueprints ?? {};
}

function searchBlueprints(q: string): Array<{
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
}> {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];

  const prefix: ReturnType<typeof searchBlueprints> = [];
  const substr: ReturnType<typeof searchBlueprints> = [];
  for (const bp of Object.values(blueprints())) {
    const haystack = `${bp.blueprintName} ${bp.productName}`.toLowerCase();
    const row = {
      blueprintId: bp.blueprintId,
      blueprintName: bp.blueprintName,
      productTypeId: bp.productTypeId,
      productName: bp.productName,
      productQuantity: bp.productQuantity,
    };
    if (bp.blueprintName.toLowerCase().startsWith(query) || bp.productName.toLowerCase().startsWith(query)) prefix.push(row);
    else if (haystack.includes(query)) substr.push(row);
  }

  prefix.sort((a, b) => a.productName.length - b.productName.length || a.productName.localeCompare(b.productName));
  substr.sort((a, b) => a.productName.localeCompare(b.productName));
  return [...prefix, ...substr].slice(0, 25);
}

function pilotSkills(characterId: 'max' | number): IndustryPilotSkills | null {
  if (characterId === 'max') {
    return {
      kind: 'max',
      skillLevels: new Map(),
      skillpoints: new Map(),
      attributes: null,
    };
  }

  const skills = getCharacterSkills(characterId);
  if (!skills) return null;

  return {
    kind: 'character',
    skillLevels: new Map(skills.skills.map(s => [s.skill_id, s.active_skill_level])),
    skillpoints: new Map(skills.skills.map(s => [s.skill_id, s.skillpoints_in_skill])),
    attributes: getCharacterAttributes(characterId),
  };
}

function enrichBlueprintSkills(blueprint: IndustryBlueprintData, data: MasteryData): IndustryBlueprint {
  return {
    ...blueprint,
    requiredSkills: blueprint.requiredSkills.map(skill => {
      const meta = data.skills[String(skill.skillId)];
      return {
        ...skill,
        primary: meta?.primary ?? null,
        secondary: meta?.secondary ?? null,
      };
    }),
  };
}

export interface IndustryRouteDeps {
  currentUser?: CurrentUserResolver;
  ownsCharacter?: OwnsCharacter;
}

export function registerIndustryRoutes(app: FastifyInstance, deps: IndustryRouteDeps = {}) {
  const currentUser = routeCurrentUser(deps);
  const owns = deps.ownsCharacter;

  app.get<{ Querystring: { q?: string } }>('/api/industry/blueprints', async (req, reply) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return searchBlueprints(parsed.data.q ?? '');
  });

  app.get<{
    Querystring: { blueprintId?: string; characterId?: string; runs?: string; me?: string; te?: string };
  }>('/api/industry/quote', async (req, reply) => {
    const parsed = quoteQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const masteryData = loadMasteryData();
    const blueprint = masteryData.industry?.blueprints[String(parsed.data.blueprintId)];
    if (!blueprint) return reply.code(404).send({ error: 'Blueprint not found' });

    const characterId = parsed.data.characterId === 'max' ? 'max' : Number(parsed.data.characterId);
    if (characterId !== 'max' && !Number.isFinite(characterId)) {
      return reply.code(400).send({ error: 'characterId must be "max" or a numeric character id' });
    }
    if (characterId !== 'max') {
      const user = await requireUser(req, reply, currentUser);
      if (!user) return reply;
      if (!requireOwnedCharacter(user.id, characterId, reply, owns)) return reply;
    }

    const pilot = pilotSkills(characterId);
    if (!pilot) {
      return reply.code(409).send({ error: 'Character skills not yet polled. Wait for the next skill poll and try again.' });
    }

    return calculateIndustryQuote({
      blueprint: enrichBlueprintSkills(blueprint, masteryData),
      runs: parsed.data.runs,
      me: parsed.data.me,
      te: parsed.data.te,
      characterId,
      pilot,
    });
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/industry/plan', async (req, reply) => {
    const parsed = planQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const masteryData = loadMasteryData();
    const blueprint = masteryData.industry?.blueprints[String(parsed.data.blueprintId)];
    if (!blueprint) return reply.code(404).send({ error: 'Blueprint not found' });

    const characterId = parsed.data.characterId === 'max' ? 'max' : Number(parsed.data.characterId);
    if (characterId !== 'max' && !Number.isFinite(characterId)) {
      return reply.code(400).send({ error: 'characterId must be "max" or a numeric character id' });
    }
    if (characterId !== 'max') {
      const user = await requireUser(req, reply, currentUser);
      if (!user) return reply;
      if (!requireOwnedCharacter(user.id, characterId, reply, owns)) return reply;
    }

    const pilot = pilotSkills(characterId);
    if (!pilot) {
      return reply.code(409).send({ error: 'Character skills not yet polled. Wait for the next skill poll and try again.' });
    }

    const bonuses: IndustryPlanBonuses = {
      manufacturingTimeBonus: parsed.data.manufacturingTimeBonus,
      manufacturingMaterialBonus: parsed.data.manufacturingMaterialBonus,
      inventionTimeBonus: parsed.data.inventionTimeBonus,
      copyingTimeBonus: parsed.data.copyingTimeBonus,
      reactionTimeBonus: parsed.data.reactionTimeBonus,
      reactionMaterialBonus: parsed.data.reactionMaterialBonus,
      jobFeeBonus: parsed.data.jobFeeBonus,
      facilityTax: parsed.data.facilityTax,
    };

    try {
      const systemCostIndex = parsed.data.systemId ? await getSystemCostIndex(parsed.data.systemId) : null;
      const adjustedPrices = parsed.data.systemId ? await getAdjustedPrices() : null;
      const plan = calculateIndustryPlan({
        data: masteryData,
        blueprint,
        runs: parsed.data.runs,
        characterId,
        pilot,
        buildInputs: parsed.data.buildInputs,
        supportMe: parsed.data.supportMe,
        supportTe: parsed.data.supportTe,
        decryptorKey: DECRYPTORS.some(d => d.key === parsed.data.decryptor) ? parsed.data.decryptor : 'none',
        bonuses,
        systemCostIndex,
        adjustedPrices,
      });
      return {
        ...plan,
        system: parsed.data.systemId
          ? {
              systemId: parsed.data.systemId,
              systemName: await resolveSystem(parsed.data.systemId).catch(() => `System ${parsed.data.systemId}`),
              costIndices: systemCostIndex?.cost_indices ?? [],
            }
          : null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to calculate industry plan';
      return reply.code(500).send({ error: message });
    }
  });

  app.get<{ Querystring: { systemId?: string } }>('/api/industry/system-costs', async (req, reply) => {
    const parsed = systemCostQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const costIndex = await getSystemCostIndex(parsed.data.systemId);
    return {
      systemId: parsed.data.systemId,
      systemName: await resolveSystem(parsed.data.systemId).catch(() => `System ${parsed.data.systemId}`),
      costIndices: costIndex?.cost_indices ?? [],
    };
  });
}
