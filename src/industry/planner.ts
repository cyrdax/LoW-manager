import { skillPointsForLevel, type IndustryPilotSkills } from './calculator.ts';
import { trainingSecondsForSp } from '../skills/training-time.ts';
import type { IndustryActivityData, IndustryBlueprintData, MasteryData } from '../skills/mastery-data.ts';
import type { IndustrySystemCostIndex, MarketAdjustedPrice } from '../esi/industry.ts';

export const ACTIVITY_MANUFACTURING = 1;
export const ACTIVITY_RESEARCH_TIME = 3;
export const ACTIVITY_RESEARCH_MATERIAL = 4;
export const ACTIVITY_COPYING = 5;
export const ACTIVITY_INVENTION = 8;
export const ACTIVITY_REACTIONS = 11;

const INDUSTRY_SKILL_ID = 3380;
const ADVANCED_INDUSTRY_SKILL_ID = 3388;

export interface IndustryDecryptor {
  key: string;
  name: string;
  probabilityMultiplier: number;
  runModifier: number;
  meModifier: number;
  teModifier: number;
}

export const DECRYPTORS: IndustryDecryptor[] = [
  { key: 'none', name: 'No decryptor', probabilityMultiplier: 1, runModifier: 0, meModifier: 0, teModifier: 0 },
  { key: 'accelerant', name: 'Accelerant', probabilityMultiplier: 1.2, runModifier: 1, meModifier: 2, teModifier: 10 },
  { key: 'attainment', name: 'Attainment', probabilityMultiplier: 1.8, runModifier: 4, meModifier: -1, teModifier: 4 },
  { key: 'augmentation', name: 'Augmentation', probabilityMultiplier: 0.6, runModifier: 9, meModifier: -2, teModifier: 2 },
  { key: 'optimized-attainment', name: 'Optimized Attainment', probabilityMultiplier: 1.9, runModifier: 2, meModifier: 1, teModifier: -2 },
  { key: 'optimized-augmentation', name: 'Optimized Augmentation', probabilityMultiplier: 0.9, runModifier: 7, meModifier: 2, teModifier: 0 },
  { key: 'parity', name: 'Parity', probabilityMultiplier: 1.5, runModifier: 3, meModifier: 1, teModifier: -2 },
  { key: 'process', name: 'Process', probabilityMultiplier: 1.1, runModifier: 0, meModifier: 3, teModifier: 6 },
  { key: 'symmetry', name: 'Symmetry', probabilityMultiplier: 1, runModifier: 2, meModifier: 1, teModifier: 8 },
];

export interface IndustryPlanBonuses {
  manufacturingTimeBonus: number;
  manufacturingMaterialBonus: number;
  inventionTimeBonus: number;
  copyingTimeBonus: number;
  reactionTimeBonus: number;
  reactionMaterialBonus: number;
  jobFeeBonus: number;
  facilityTax: number;
}

export interface IndustryPlanInput {
  data: MasteryData;
  blueprint: IndustryBlueprintData;
  runs: number;
  characterId: 'max' | number;
  pilot: IndustryPilotSkills;
  buildInputs: boolean;
  supportMe: number;
  supportTe: number;
  decryptorKey: string;
  bonuses: IndustryPlanBonuses;
  systemCostIndex?: IndustrySystemCostIndex | null;
  adjustedPrices?: Map<number, MarketAdjustedPrice> | null;
}

export interface IndustryPlanJob {
  activityId: number;
  activityName: string;
  blueprintId: number;
  blueprintName: string;
  productTypeId: number | null;
  productName: string;
  runs: number;
  baseSeconds: number;
  adjustedSeconds: number;
  systemCostIndex: number | null;
  estimatedInstallFee: number | null;
}

export interface IndustryPlanSkill {
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
}

export interface IndustryPlan {
  target: {
    blueprintId: number;
    blueprintName: string;
    productTypeId: number;
    productName: string;
    quantity: number;
  };
  assumptions: {
    buildInputs: boolean;
    supportMe: number;
    supportTe: number;
    decryptor: IndustryDecryptor;
    inventionOutput: { me: number; te: number; runsPerSuccessfulBpc: number } | null;
    bonuses: IndustryPlanBonuses;
  };
  invention: {
    sourceBlueprintId: number;
    sourceBlueprintName: string;
    chance: number;
    successfulBpcsNeeded: number;
    expectedAttempts: number;
    copyRunsNeeded: number;
    materialsPerAttempt: Array<{ typeId: number; name: string; quantity: number }>;
    expectedMaterials: Array<{ typeId: number; name: string; quantity: number }>;
  } | null;
  jobs: IndustryPlanJob[];
  materials: {
    final: Array<{ typeId: number; name: string; quantity: number }>;
    raw: Array<{ typeId: number; name: string; quantity: number }>;
  };
  skills: IndustryPlanSkill[];
  totals: {
    jobSeconds: number;
    skillTrainingSeconds: number;
    totalSerialSeconds: number;
    estimatedInstallFees: number | null;
    rawMaterialLines: number;
    jobs: number;
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function multiplierFromBonus(value: number): number {
  return 1 - clampPercent(value) / 100;
}

function activityName(activityId: number): string {
  switch (activityId) {
    case ACTIVITY_MANUFACTURING: return 'Manufacturing';
    case ACTIVITY_RESEARCH_TIME: return 'TE research';
    case ACTIVITY_RESEARCH_MATERIAL: return 'ME research';
    case ACTIVITY_COPYING: return 'Copying';
    case ACTIVITY_INVENTION: return 'Invention';
    case ACTIVITY_REACTIONS: return 'Reactions';
    default: return `Activity ${activityId}`;
  }
}

function esiActivityName(activityId: number): string | null {
  switch (activityId) {
    case ACTIVITY_MANUFACTURING: return 'manufacturing';
    case ACTIVITY_RESEARCH_TIME: return 'researching_time_efficiency';
    case ACTIVITY_RESEARCH_MATERIAL: return 'researching_material_efficiency';
    case ACTIVITY_COPYING: return 'copying';
    case ACTIVITY_INVENTION: return 'invention';
    case ACTIVITY_REACTIONS: return 'reaction';
    default: return null;
  }
}

function costIndexFor(system: IndustrySystemCostIndex | null | undefined, activityId: number): number | null {
  const name = esiActivityName(activityId);
  if (!system || !name) return null;
  return system.cost_indices.find(c => c.activity === name)?.cost_index ?? null;
}

function adjustedPrice(prices: Map<number, MarketAdjustedPrice> | null | undefined, typeId: number): number | null {
  const row = prices?.get(typeId);
  return row?.adjusted_price ?? row?.average_price ?? null;
}

function activityTimeMultiplier(activityId: number, bonuses: IndustryPlanBonuses): number {
  switch (activityId) {
    case ACTIVITY_MANUFACTURING: return multiplierFromBonus(bonuses.manufacturingTimeBonus);
    case ACTIVITY_INVENTION: return multiplierFromBonus(bonuses.inventionTimeBonus);
    case ACTIVITY_COPYING: return multiplierFromBonus(bonuses.copyingTimeBonus);
    case ACTIVITY_REACTIONS: return multiplierFromBonus(bonuses.reactionTimeBonus);
    case ACTIVITY_RESEARCH_TIME:
    case ACTIVITY_RESEARCH_MATERIAL:
      return multiplierFromBonus(bonuses.copyingTimeBonus);
    default: return 1;
  }
}

function activityMaterialMultiplier(activityId: number, bonuses: IndustryPlanBonuses): number {
  if (activityId === ACTIVITY_MANUFACTURING) return multiplierFromBonus(bonuses.manufacturingMaterialBonus);
  if (activityId === ACTIVITY_REACTIONS) return multiplierFromBonus(bonuses.reactionMaterialBonus);
  return 1;
}

function activityAdjustedSeconds(
  activity: IndustryActivityData,
  runs: number,
  te: number,
  pilot: IndustryPilotSkills,
  bonuses: IndustryPlanBonuses,
): number {
  const industryLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(INDUSTRY_SKILL_ID) ?? 0);
  const advancedIndustryLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(ADVANCED_INDUSTRY_SKILL_ID) ?? 0);
  const blueprintTe = activity.activityId === ACTIVITY_MANUFACTURING ? multiplierFromBonus(te) : 1;
  const industrySkill = activity.activityId === ACTIVITY_MANUFACTURING ? (1 - industryLevel * 0.04) : 1;
  const advancedIndustrySkill = 1 - advancedIndustryLevel * 0.03;
  return Math.ceil(
    activity.timeSeconds *
      runs *
      blueprintTe *
      industrySkill *
      advancedIndustrySkill *
      activityTimeMultiplier(activity.activityId, bonuses),
  );
}

function materialQuantity(base: number, runs: number, activityId: number, me: number, bonuses: IndustryPlanBonuses): number {
  const blueprintMe = activityId === ACTIVITY_MANUFACTURING ? multiplierFromBonus(me) : 1;
  return Math.max(1, Math.ceil(base * runs * blueprintMe * activityMaterialMultiplier(activityId, bonuses)));
}

function estimateInstallFee(
  materials: Array<{ typeId: number; quantity: number }>,
  activityId: number,
  systemCostIndex: IndustrySystemCostIndex | null | undefined,
  prices: Map<number, MarketAdjustedPrice> | null | undefined,
  bonuses: IndustryPlanBonuses,
): number | null {
  const index = costIndexFor(systemCostIndex, activityId);
  if (index == null) return null;
  let estimatedValue = 0;
  for (const material of materials) {
    const price = adjustedPrice(prices, material.typeId);
    if (price == null) return null;
    estimatedValue += price * material.quantity;
  }
  const jobCostFactor = Math.max(0, index * multiplierFromBonus(bonuses.jobFeeBonus) + bonuses.facilityTax / 100);
  return Math.ceil(estimatedValue * jobCostFactor);
}

function addQuantity(map: Map<number, { typeId: number; name: string; quantity: number }>, typeId: number, name: string, quantity: number) {
  const existing = map.get(typeId);
  if (existing) existing.quantity += quantity;
  else map.set(typeId, { typeId, name, quantity });
}

function mergeTargets(targets: Map<number, number>, skillId: number, level: number) {
  targets.set(skillId, Math.max(targets.get(skillId) ?? 0, level));
}

function productBlueprints(data: MasteryData, activityId: number): Map<number, IndustryBlueprintData> {
  const out = new Map<number, IndustryBlueprintData>();
  for (const blueprint of Object.values(data.industry?.blueprints ?? {})) {
    const activity = blueprint.activities?.[String(activityId)];
    if (!activity) continue;
    for (const product of activity.products) out.set(product.typeId, blueprint);
  }
  return out;
}

function findInventionSource(data: MasteryData, targetBlueprintId: number): {
  sourceBlueprint: IndustryBlueprintData;
  activity: IndustryActivityData;
  product: { typeId: number; name: string; quantity: number; probability?: number };
} | null {
  for (const sourceBlueprint of Object.values(data.industry?.blueprints ?? {})) {
    const activity = sourceBlueprint.activities?.[String(ACTIVITY_INVENTION)];
    if (!activity) continue;
    const product = activity.products.find(p => p.typeId === targetBlueprintId);
    if (product) return { sourceBlueprint, activity, product };
  }
  return null;
}

function inventionChance(
  baseChance: number,
  activity: IndustryActivityData,
  decryptor: IndustryDecryptor,
  pilot: IndustryPilotSkills,
): number {
  const levels = activity.requiredSkills.map(skill => {
    const current = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(skill.skillId) ?? 0);
    return Math.max(current, skill.level);
  });
  const encryptionIndex = activity.requiredSkills.findIndex(s => /Encryption Methods/i.test(s.name));
  const encryptionLevel = encryptionIndex >= 0 ? levels[encryptionIndex] : 0;
  const scienceLevels = levels.reduce((n, level, i) => i === encryptionIndex ? n : n + level, 0);
  return Math.min(1, baseChance * (1 + encryptionLevel * 0.025 + scienceLevels / 30) * decryptor.probabilityMultiplier);
}

function buildSkillPlan(
  targets: Map<number, number>,
  data: MasteryData,
  pilot: IndustryPilotSkills,
): IndustryPlanSkill[] {
  const queue = Array.from(targets.keys());
  for (let i = 0; i < queue.length; i++) {
    const skillId = queue[i];
    const meta = data.skills[String(skillId)];
    for (const prereq of meta?.requiredSkills ?? []) {
      const before = targets.get(prereq.skillId) ?? 0;
      if (prereq.level > before) {
        targets.set(prereq.skillId, prereq.level);
        queue.push(prereq.skillId);
      }
    }
  }

  return Array.from(targets.entries()).map(([skillId, requiredLevel]) => {
    const meta = data.skills[String(skillId)];
    const rank = meta?.rank ?? 1;
    const currentLevel = pilot.kind === 'max' ? 5 : (pilot.skillLevels.get(skillId) ?? 0);
    const currentSp = pilot.kind === 'max'
      ? skillPointsForLevel(rank, 5)
      : (pilot.skillpoints.get(skillId) ?? skillPointsForLevel(rank, currentLevel));
    const targetSp = skillPointsForLevel(rank, requiredLevel);
    const spGap = Math.max(0, targetSp - currentSp);
    return {
      skillId,
      name: meta?.name ?? `Skill ${skillId}`,
      rank,
      requiredLevel,
      currentLevel,
      currentSp,
      targetSp,
      spGap,
      trainingSeconds: pilot.kind === 'max' ? 0 : trainingSecondsForSp(spGap, meta?.primary, meta?.secondary, pilot.attributes),
      met: currentLevel >= requiredLevel,
    };
  }).sort((a, b) => Number(a.met) - Number(b.met) || b.spGap - a.spGap || a.name.localeCompare(b.name));
}

export function calculateIndustryPlan(input: IndustryPlanInput): IndustryPlan {
  const { data, blueprint, runs, pilot, buildInputs, supportMe, supportTe, bonuses, systemCostIndex, adjustedPrices } = input;
  const decryptor = DECRYPTORS.find(d => d.key === input.decryptorKey) ?? DECRYPTORS[0];
  const manufacturingByProduct = productBlueprints(data, ACTIVITY_MANUFACTURING);
  const reactionByProduct = productBlueprints(data, ACTIVITY_REACTIONS);

  const jobs: IndustryPlanJob[] = [];
  const skillTargets = new Map<number, number>();
  const rawMaterials = new Map<number, { typeId: number; name: string; quantity: number }>();

  function addActivitySkills(activity: IndustryActivityData) {
    for (const skill of activity.requiredSkills) mergeTargets(skillTargets, skill.skillId, skill.level);
  }

  function addJob(
    bp: IndustryBlueprintData,
    activity: IndustryActivityData,
    jobRuns: number,
    me: number,
    te: number,
    productName: string,
  ): Array<{ typeId: number; name: string; quantity: number }> {
    addActivitySkills(activity);
    const adjustedMaterials = activity.materials.map(material => ({
      typeId: material.typeId,
      name: material.name,
      quantity: materialQuantity(material.quantity, jobRuns, activity.activityId, me, bonuses),
    }));
    const adjustedSeconds = activityAdjustedSeconds(activity, jobRuns, te, pilot, bonuses);
    jobs.push({
      activityId: activity.activityId,
      activityName: activityName(activity.activityId),
      blueprintId: bp.blueprintId,
      blueprintName: bp.blueprintName,
      productTypeId: activity.products[0]?.typeId ?? null,
      productName,
      runs: jobRuns,
      baseSeconds: activity.timeSeconds * jobRuns,
      adjustedSeconds,
      systemCostIndex: costIndexFor(systemCostIndex, activity.activityId),
      estimatedInstallFee: estimateInstallFee(adjustedMaterials, activity.activityId, systemCostIndex, adjustedPrices, bonuses),
    });
    return adjustedMaterials;
  }

  function buildProduct(typeId: number, name: string, quantity: number, depth: number) {
    if (!buildInputs || depth > 8) {
      addQuantity(rawMaterials, typeId, name, quantity);
      return;
    }
    const bp = manufacturingByProduct.get(typeId) ?? reactionByProduct.get(typeId);
    if (!bp) {
      addQuantity(rawMaterials, typeId, name, quantity);
      return;
    }
    const activity = bp.activities?.[String(manufacturingByProduct.has(typeId) ? ACTIVITY_MANUFACTURING : ACTIVITY_REACTIONS)];
    const product = activity?.products.find(p => p.typeId === typeId);
    if (!activity || !product) {
      addQuantity(rawMaterials, typeId, name, quantity);
      return;
    }
    const jobRuns = Math.ceil(quantity / product.quantity);
    const materials = addJob(bp, activity, jobRuns, supportMe, supportTe, product.name);
    for (const material of materials) buildProduct(material.typeId, material.name, material.quantity, depth + 1);
  }

  const inventionSource = findInventionSource(data, blueprint.blueprintId);
  const targetIsShip = !!data.ships[String(blueprint.productTypeId)];
  let targetMe = 0;
  let targetTe = 0;
  let inventedRuns = 0;
  let invention: IndustryPlan['invention'] = null;

  if (inventionSource) {
    const baseRuns = targetIsShip ? 1 : 10;
    targetMe = Math.max(0, 2 + decryptor.meModifier);
    targetTe = Math.max(0, 4 + decryptor.teModifier);
    inventedRuns = Math.max(1, baseRuns + decryptor.runModifier);
    const successfulBpcsNeeded = Math.ceil(runs / inventedRuns);
    const chance = inventionChance(inventionSource.product.probability ?? 0, inventionSource.activity, decryptor, pilot);
    const expectedAttempts = chance > 0 ? successfulBpcsNeeded / chance : Number.POSITIVE_INFINITY;
    const copyRunsNeeded = Math.ceil(expectedAttempts);

    const copyActivity = inventionSource.sourceBlueprint.activities?.[String(ACTIVITY_COPYING)];
    if (copyActivity) addJob(inventionSource.sourceBlueprint, copyActivity, copyRunsNeeded, supportMe, supportTe, `${inventionSource.sourceBlueprint.blueprintName} copy`);
    addJob(inventionSource.sourceBlueprint, inventionSource.activity, Math.ceil(expectedAttempts), supportMe, supportTe, inventionSource.product.name);

    const expectedMaterials = inventionSource.activity.materials.map(material => ({
      typeId: material.typeId,
      name: material.name,
      quantity: Math.ceil(material.quantity * expectedAttempts),
    }));
    invention = {
      sourceBlueprintId: inventionSource.sourceBlueprint.blueprintId,
      sourceBlueprintName: inventionSource.sourceBlueprint.blueprintName,
      chance,
      successfulBpcsNeeded,
      expectedAttempts,
      copyRunsNeeded,
      materialsPerAttempt: inventionSource.activity.materials,
      expectedMaterials,
    };
    for (const material of expectedMaterials) addQuantity(rawMaterials, material.typeId, material.name, material.quantity);
  } else {
    targetMe = input.supportMe;
    targetTe = input.supportTe;
  }

  const targetActivity = blueprint.activities?.[String(ACTIVITY_MANUFACTURING)];
  if (!targetActivity) throw new Error(`Blueprint ${blueprint.blueprintName} has no manufacturing activity`);
  const targetProduct = targetActivity.products.find(p => p.typeId === blueprint.productTypeId) ?? targetActivity.products[0];
  const targetJobRuns = Math.ceil(runs / (targetProduct?.quantity ?? 1));
  const finalMaterials = addJob(blueprint, targetActivity, targetJobRuns, targetMe, targetTe, blueprint.productName);
  for (const material of finalMaterials) buildProduct(material.typeId, material.name, material.quantity, 0);

  const skills = buildSkillPlan(skillTargets, data, pilot);
  const jobSeconds = jobs.reduce((n, job) => n + job.adjustedSeconds, 0);
  const skillTrainingSeconds = skills.reduce((n, skill) => n + skill.trainingSeconds, 0);
  const feeValues = jobs.map(job => job.estimatedInstallFee);
  const estimatedInstallFees = feeValues.some(v => v == null)
    ? null
    : feeValues.reduce<number>((n, v) => n + (v ?? 0), 0);

  return {
    target: {
      blueprintId: blueprint.blueprintId,
      blueprintName: blueprint.blueprintName,
      productTypeId: blueprint.productTypeId,
      productName: blueprint.productName,
      quantity: runs,
    },
    assumptions: {
      buildInputs,
      supportMe,
      supportTe,
      decryptor,
      inventionOutput: invention ? { me: targetMe, te: targetTe, runsPerSuccessfulBpc: inventedRuns } : null,
      bonuses,
    },
    invention,
    jobs,
    materials: {
      final: finalMaterials,
      raw: Array.from(rawMaterials.values()).sort((a, b) => a.name.localeCompare(b.name)),
    },
    skills,
    totals: {
      jobSeconds,
      skillTrainingSeconds,
      totalSerialSeconds: jobSeconds + skillTrainingSeconds,
      estimatedInstallFees,
      rawMaterialLines: rawMaterials.size,
      jobs: jobs.length,
    },
  };
}
