import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCharacterAttributes, getCharacterSkills } from '../polling/scheduler.ts';
import { calculateIndustryQuote, type IndustryBlueprint, type IndustryPilotSkills } from '../industry/calculator.ts';
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

export function registerIndustryRoutes(app: FastifyInstance) {
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
}
