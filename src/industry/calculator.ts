import { trainingSecondsForSp, type CharacterAttributes } from '../skills/training-time.ts';

export interface IndustryMaterial {
  typeId: number;
  name: string;
  quantity: number;
}

export interface IndustryRequiredSkill {
  skillId: number;
  name: string;
  level: number;
  rank: number;
  primary?: number | null;
  secondary?: number | null;
}

export interface IndustryBlueprint {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
  baseTimeSeconds: number;
  materials: IndustryMaterial[];
  requiredSkills: IndustryRequiredSkill[];
}

export interface IndustryPilotSkills {
  kind: 'max' | 'character';
  skillLevels: Map<number, number>;
  skillpoints: Map<number, number>;
  attributes?: CharacterAttributes | null;
}

export interface IndustryQuoteInput {
  blueprint: IndustryBlueprint;
  runs: number;
  me: number;
  te: number;
  characterId: 'max' | number;
  pilot: IndustryPilotSkills;
}

export interface IndustryQuote {
  blueprint: {
    blueprintId: number;
    blueprintName: string;
    productTypeId: number;
    productName: string;
    productQuantity: number;
  };
  inputs: { runs: number; me: number; te: number; characterId: 'max' | number };
  output: { typeId: number; name: string; quantity: number };
  time: { baseSeconds: number; adjustedSeconds: number; perRunSeconds: number };
  materials: Array<{ typeId: number; name: string; baseQuantity: number; adjustedQuantity: number }>;
  skills: Array<{
    skillId: number;
    name: string;
    rank: number;
    requiredLevel: number;
    currentLevel: number;
    currentSp: number;
    targetSp: number;
    spGap: number;
    trainingSeconds: number;
    met: boolean;
  }>;
  totals: { totalSpGap: number; totalTrainingSeconds: number; missingSkills: number; totalSkills: number };
}

const INDUSTRY_SKILL_ID = 3380;
const ADVANCED_INDUSTRY_SKILL_ID = 3388;

export function skillPointsForLevel(rank: number, level: number): number {
  if (level <= 0) return 0;
  return Math.ceil(250 * rank * Math.pow(32, (level - 1) / 2));
}

export function calculateIndustryQuote(input: IndustryQuoteInput): IndustryQuote {
  const { blueprint, runs, me, te, characterId, pilot } = input;
  const industryLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(INDUSTRY_SKILL_ID) ?? 0);
  const advancedIndustryLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(ADVANCED_INDUSTRY_SKILL_ID) ?? 0);
  const perRunSeconds = Math.ceil(
    blueprint.baseTimeSeconds *
      (1 - te / 100) *
      (1 - industryLevel * 0.04) *
      (1 - advancedIndustryLevel * 0.03),
  );

  const skills = blueprint.requiredSkills.map(skill => {
    const currentLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(skill.skillId) ?? 0);
    const currentSp = pilot.kind === 'max'
      ? skillPointsForLevel(skill.rank, 5)
      : (pilot.skillpoints.get(skill.skillId) ?? skillPointsForLevel(skill.rank, currentLevel));
    const targetSp = skillPointsForLevel(skill.rank, skill.level);
    const spGap = Math.max(0, targetSp - currentSp);
    const trainingSeconds = pilot.kind === 'max'
      ? 0
      : trainingSecondsForSp(spGap, skill.primary, skill.secondary, pilot.attributes);
    return {
      skillId: skill.skillId,
      name: skill.name,
      rank: skill.rank,
      requiredLevel: skill.level,
      currentLevel,
      currentSp,
      targetSp,
      spGap,
      trainingSeconds,
      met: currentLevel >= skill.level,
    };
  }).sort((a, b) => Number(a.met) - Number(b.met) || b.spGap - a.spGap || a.name.localeCompare(b.name));

  return {
    blueprint: {
      blueprintId: blueprint.blueprintId,
      blueprintName: blueprint.blueprintName,
      productTypeId: blueprint.productTypeId,
      productName: blueprint.productName,
      productQuantity: blueprint.productQuantity,
    },
    inputs: { runs, me, te, characterId },
    output: {
      typeId: blueprint.productTypeId,
      name: blueprint.productName,
      quantity: blueprint.productQuantity * runs,
    },
    time: {
      baseSeconds: blueprint.baseTimeSeconds * runs,
      perRunSeconds,
      adjustedSeconds: perRunSeconds * runs,
    },
    materials: blueprint.materials.map(material => ({
      typeId: material.typeId,
      name: material.name,
      baseQuantity: material.quantity * runs,
      adjustedQuantity: Math.max(1, Math.ceil(material.quantity * runs * (1 - me / 100))),
    })),
    skills,
    totals: {
      totalSpGap: skills.reduce((n, s) => n + s.spGap, 0),
      totalTrainingSeconds: skills.reduce((n, s) => n + s.trainingSeconds, 0),
      missingSkills: skills.filter(s => !s.met).length,
      totalSkills: skills.length,
    },
  };
}
