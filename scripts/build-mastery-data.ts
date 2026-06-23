/**
 * Build script: extracts ship/cert/skill/industry data into a single compact
 * JSON the app loads at runtime. CCP's YAML SDE currently carries the mastery
 * certificate graph; Fuzzwork's latest CSV dump overlays current type, dogma,
 * and industry tables so new hulls/blueprints show up promptly.
 *
 *   npm run build:mastery
 *
 * Output: data/eve-mastery.json (~4MB).
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SDE_URL = 'https://eve-static-data-export.s3-eu-west-1.amazonaws.com/tranquility/sde.zip';
const FUZZWORK_CSV_BASE = 'https://www.fuzzwork.co.uk/dump/latest/csv';
const CACHE_DIR = resolve(ROOT, '.cache');
const SDE_ZIP = resolve(CACHE_DIR, 'sde.zip');
const FUZZWORK_CACHE_DIR = resolve(CACHE_DIR, 'fuzzwork');
const OUT_PATH = resolve(ROOT, 'data', 'eve-mastery.json');

// Dogma attribute IDs (well-known, stable across SDE releases)
const ATTR_REQUIRED_SKILL = [182, 183, 184, 1285, 1289, 1290];
const ATTR_REQUIRED_LEVEL = [277, 278, 279, 1286, 1287, 1288];
const ATTR_PRIMARY = 180;
const ATTR_SECONDARY = 181;
const ATTR_SKILL_RANK = 275;
const SHIP_CATEGORY_ID = 6;

const MASTERY_GRADES = ['basic', 'standard', 'improved', 'advanced', 'elite'] as const;

interface Cert {
  name: string;
  groupID: number;
  description: string;
  recommendedFor?: number[];
  skillTypes: Record<string, Record<typeof MASTERY_GRADES[number], number>>;
}

interface SdeType {
  name: { en: string };
  groupID: number;
  published?: boolean;
  masteries?: Record<string, number[]>;
}

interface SdeGroup {
  categoryID: number;
  name: { en: string };
  published?: boolean;
}

interface DogmaAttr { attributeID: number; value: number }
interface SdeTypeDogma { dogmaAttributes: DogmaAttr[] }

interface FuzzworkStamp {
  files: Record<string, { lastModified: string | null; contentLength: string | null }>;
}

interface FuzzType {
  typeId: number;
  groupId: number;
  name: string;
  published: boolean;
}

interface FuzzGroup {
  groupId: number;
  categoryId: number;
  name: string;
  published: boolean;
}

interface FuzzCategory {
  categoryId: number;
  name: string;
}

interface SdeBlueprintActivityMaterial {
  typeID: number;
  quantity: number;
}

interface SdeBlueprintActivityProduct {
  typeID: number;
  quantity: number;
}

interface SdeBlueprintActivitySkill {
  typeID: number;
  level: number;
}

interface SdeBlueprint {
  activities?: {
    manufacturing?: {
      materials?: SdeBlueprintActivityMaterial[];
      products?: SdeBlueprintActivityProduct[];
      skills?: SdeBlueprintActivitySkill[];
      time?: number;
    };
  };
}

interface OutShip {
  name: string;
  groupId: number;
  groupName: string;
  requiredSkills: Array<{ skillId: number; level: number }>;
  masteries: number[][];
}

interface OutItem {
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  requiredSkills: Array<{ skillId: number; level: number }>;
}

interface OutCert {
  name: string;
  skills: Array<{ skillId: number; levels: [number, number, number, number, number] }>;
}

interface OutSkill {
  name: string;
  rank: number;
  primary: number | null;
  secondary: number | null;
  requiredSkills: Array<{ skillId: number; level: number }>;
}

interface OutIndustryActivityProduct {
  typeId: number;
  name: string;
  quantity: number;
  probability?: number;
}

interface OutIndustryActivity {
  activityId: number;
  timeSeconds: number;
  materials: Array<{ typeId: number; name: string; quantity: number }>;
  products: OutIndustryActivityProduct[];
  requiredSkills: Array<{ skillId: number; name: string; level: number; rank: number }>;
}

interface OutIndustryBlueprint {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
  baseTimeSeconds: number;
  materials: Array<{ typeId: number; name: string; quantity: number }>;
  requiredSkills: Array<{ skillId: number; name: string; level: number; rank: number }>;
  activities?: Record<string, OutIndustryActivity>;
}

async function fetchSdeIfNeeded(): Promise<{ etag: string | null; lastModified: string | null }> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`[sde] HEAD ${SDE_URL}`);
  const head = await fetch(SDE_URL, { method: 'HEAD' });
  if (!head.ok) throw new Error(`SDE HEAD failed: ${head.status}`);
  const etag = head.headers.get('etag');
  const lastModified = head.headers.get('last-modified');

  // Skip download if we already have a matching ETag stamped alongside.
  const stampPath = `${SDE_ZIP}.etag`;
  const cachedEtag = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';
  if (existsSync(SDE_ZIP) && cachedEtag && cachedEtag === etag) {
    console.log(`[sde] cache hit (etag ${etag})`);
    return { etag, lastModified };
  }

  console.log(`[sde] downloading (~107MB) …`);
  const res = await fetch(SDE_URL);
  if (!res.ok) throw new Error(`SDE GET failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(SDE_ZIP, buf);
  if (etag) writeFileSync(stampPath, etag);
  console.log(`[sde] saved ${buf.length} bytes`);
  return { etag, lastModified };
}

async function fetchFuzzworkCsvIfNeeded(files: string[]): Promise<FuzzworkStamp> {
  if (!existsSync(FUZZWORK_CACHE_DIR)) mkdirSync(FUZZWORK_CACHE_DIR, { recursive: true });

  const stampPath = resolve(FUZZWORK_CACHE_DIR, 'stamp.json');
  const cachedStamp: FuzzworkStamp = existsSync(stampPath)
    ? JSON.parse(readFileSync(stampPath, 'utf8')) as FuzzworkStamp
    : { files: {} };
  const nextStamp: FuzzworkStamp = { files: {} };

  for (const file of files) {
    const url = `${FUZZWORK_CSV_BASE}/${file}`;
    const out = resolve(FUZZWORK_CACHE_DIR, file);
    console.log(`[fuzzwork] HEAD ${url}`);
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) throw new Error(`Fuzzwork HEAD failed for ${file}: ${head.status}`);
    const current = {
      lastModified: head.headers.get('last-modified'),
      contentLength: head.headers.get('content-length'),
    };
    const cached = cachedStamp.files[file];
    nextStamp.files[file] = current;

    if (
      existsSync(out) &&
      cached &&
      cached.lastModified === current.lastModified &&
      cached.contentLength === current.contentLength
    ) {
      console.log(`[fuzzwork] cache hit ${file}`);
      continue;
    }

    console.log(`[fuzzwork] downloading ${file}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fuzzwork GET failed for ${file}: ${res.status}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }

  writeFileSync(stampPath, JSON.stringify(nextStamp, null, 2));
  return nextStamp;
}

function unzipToString(zipPath: string, member: string): string {
  // System unzip handles the 153MB types.yaml without needing a JS zip lib.
  return execSync(`unzip -p "${zipPath}" "${member}"`, { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

function loadYaml<T>(zipPath: string, member: string): T {
  console.log(`[parse] ${member}`);
  const text = unzipToString(zipPath, member);
  return yaml.load(text) as T;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atStart = true;

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      atStart = true;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atStart = true;
    } else if (ch === '\r') {
      // Ignore CR in CRLF; bare CR is not expected from Fuzzwork.
    } else {
      field += ch;
      atStart = false;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function loadCsv(file: string): Array<Record<string, string>> {
  console.log(`[parse] fuzzwork/${file}`);
  const text = readFileSync(resolve(FUZZWORK_CACHE_DIR, file), 'utf8');
  const [headers, ...rows] = parseCsv(text);
  return rows.filter(r => r.length > 1).map(row => {
    const out: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) out[headers[i]] = row[i] ?? '';
    return out;
  });
}

function csvBool(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function csvNumber(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractRequiredSkills(d: SdeTypeDogma | undefined): Array<{ skillId: number; level: number }> {
  if (!d?.dogmaAttributes) return [];
  const byId = new Map<number, number>();
  for (const a of d.dogmaAttributes) byId.set(a.attributeID, a.value);
  const out: Array<{ skillId: number; level: number }> = [];
  for (let i = 0; i < ATTR_REQUIRED_SKILL.length; i++) {
    const sid = byId.get(ATTR_REQUIRED_SKILL[i]);
    const lvl = byId.get(ATTR_REQUIRED_LEVEL[i]);
    if (sid && lvl != null) out.push({ skillId: Math.round(sid), level: Math.round(lvl) });
  }
  return out;
}

function shapeMasteries(raw: Record<string, number[]> | undefined): number[][] {
  // Normalize into a 5-element array indexed 0..4 (Mastery I..V).
  const out: number[][] = [[], [], [], [], []];
  if (!raw) return out;
  for (let i = 0; i < 5; i++) {
    const list = raw[String(i)] ?? [];
    out[i] = [...list];
  }
  return out;
}

function skillRank(skillId: number, typeDogma: Record<string, SdeTypeDogma>): number {
  const attrs = new Map<number, number>();
  for (const a of typeDogma[String(skillId)]?.dogmaAttributes ?? []) attrs.set(a.attributeID, a.value);
  return Math.round(attrs.get(ATTR_SKILL_RANK) ?? 1);
}

function skillRankFromAttrs(skillId: number, attrsByType: Map<number, Map<number, number>>): number {
  return Math.round(attrsByType.get(skillId)?.get(ATTR_SKILL_RANK) ?? 1);
}

function extractRequiredSkillsFromAttrs(attrs: Map<number, number> | undefined): Array<{ skillId: number; level: number }> {
  if (!attrs) return [];
  const out: Array<{ skillId: number; level: number }> = [];
  for (let i = 0; i < ATTR_REQUIRED_SKILL.length; i++) {
    const sid = attrs.get(ATTR_REQUIRED_SKILL[i]);
    const lvl = attrs.get(ATTR_REQUIRED_LEVEL[i]);
    if (sid && lvl != null) out.push({ skillId: Math.round(sid), level: Math.round(lvl) });
  }
  return out;
}

function activityKey(blueprintId: number, activityId: number): string {
  return `${blueprintId}:${activityId}`;
}

function overlayFuzzworkData(
  ships: Record<string, OutShip>,
  items: Record<string, OutItem>,
  industryBlueprints: Record<string, OutIndustryBlueprint>,
  skillsOut: Record<string, OutSkill>,
  usedSkillIds: Set<number>,
) {
  const fuzzFiles = [
    'invCategories.csv',
    'invGroups.csv',
    'invTypes.csv',
    'dgmTypeAttributes.csv',
    'industryActivity.csv',
    'industryActivityProducts.csv',
    'industryActivityMaterials.csv',
    'industryActivitySkills.csv',
    'industryActivityProbabilities.csv',
  ];

  const categories = new Map<number, FuzzCategory>();
  for (const row of loadCsv('invCategories.csv')) {
    const categoryId = csvNumber(row.categoryID);
    if (categoryId == null) continue;
    categories.set(categoryId, { categoryId, name: row.categoryName || `Category ${categoryId}` });
  }

  const groups = new Map<number, FuzzGroup>();
  const shipGroupIds = new Set<number>();
  for (const row of loadCsv('invGroups.csv')) {
    const groupId = csvNumber(row.groupID);
    const categoryId = csvNumber(row.categoryID);
    if (groupId == null || categoryId == null) continue;
    const group = {
      groupId,
      categoryId,
      name: row.groupName || `Group ${groupId}`,
      published: csvBool(row.published),
    };
    groups.set(groupId, group);
    if (categoryId === SHIP_CATEGORY_ID && group.published) shipGroupIds.add(groupId);
  }

  const types = new Map<number, FuzzType>();
  for (const row of loadCsv('invTypes.csv')) {
    const typeId = csvNumber(row.typeID);
    const groupId = csvNumber(row.groupID);
    if (typeId == null || groupId == null) continue;
    types.set(typeId, {
      typeId,
      groupId,
      name: row.typeName || `Type ${typeId}`,
      published: csvBool(row.published),
    });
  }

  const attrsByType = new Map<number, Map<number, number>>();
  for (const row of loadCsv('dgmTypeAttributes.csv')) {
    const typeId = csvNumber(row.typeID);
    const attrId = csvNumber(row.attributeID);
    const value = csvNumber(row.valueInt) ?? csvNumber(row.valueFloat);
    if (typeId == null || attrId == null || value == null) continue;
    let attrs = attrsByType.get(typeId);
    if (!attrs) {
      attrs = new Map();
      attrsByType.set(typeId, attrs);
    }
    attrs.set(attrId, value);
  }

  const itemExcludeCategories = new Set<number>([6, 9, 16, 91, 1, 2, 3, 4, 5, 10, 11, 14, 19, 26, 27, 29, 30]);
  for (const type of types.values()) {
    if (!type.published) continue;
    const group = groups.get(type.groupId);
    const categoryId = group?.categoryId;
    const required = extractRequiredSkillsFromAttrs(attrsByType.get(type.typeId));

    if (shipGroupIds.has(type.groupId)) {
      const existing = ships[String(type.typeId)];
      if (required.length === 0 && !existing) continue;
      ships[String(type.typeId)] = {
        name: type.name,
        groupId: type.groupId,
        groupName: group?.name ?? `Group ${type.groupId}`,
        requiredSkills: required,
        masteries: existing?.masteries ?? [[], [], [], [], []],
      };
      for (const r of required) usedSkillIds.add(r.skillId);
      continue;
    }

    if (required.length === 0) continue;
    if (categoryId == null || itemExcludeCategories.has(categoryId)) continue;
    items[String(type.typeId)] = {
      name: type.name,
      groupId: type.groupId,
      groupName: group?.name ?? `Group ${type.groupId}`,
      categoryId,
      categoryName: categories.get(categoryId)?.name ?? `Category ${categoryId}`,
      requiredSkills: required,
    };
    for (const r of required) usedSkillIds.add(r.skillId);
  }

  const activityIdsByBlueprint = new Map<number, Set<number>>();
  const noteActivity = (blueprintId: number, activityId: number) => {
    const set = activityIdsByBlueprint.get(blueprintId) ?? new Set<number>();
    set.add(activityId);
    activityIdsByBlueprint.set(blueprintId, set);
  };

  const times = new Map<string, number>();
  for (const row of loadCsv('industryActivity.csv')) {
    const typeId = csvNumber(row.typeID);
    const activityId = csvNumber(row.activityID);
    const time = csvNumber(row.time);
    if (typeId != null && activityId != null && time != null) {
      times.set(activityKey(typeId, activityId), Math.round(time));
      noteActivity(typeId, activityId);
    }
  }

  const probabilities = new Map<string, number>();
  for (const row of loadCsv('industryActivityProbabilities.csv')) {
    const blueprintId = csvNumber(row.typeID);
    const activityId = csvNumber(row.activityID);
    const productTypeId = csvNumber(row.productTypeID);
    const probability = csvNumber(row.probability);
    if (blueprintId == null || activityId == null || productTypeId == null || probability == null) continue;
    probabilities.set(`${blueprintId}:${activityId}:${productTypeId}`, probability);
  }

  const productsByActivity = new Map<string, Array<{ typeId: number; quantity: number; probability?: number }>>();
  for (const row of loadCsv('industryActivityProducts.csv')) {
    const blueprintId = csvNumber(row.typeID);
    const activityId = csvNumber(row.activityID);
    const typeId = csvNumber(row.productTypeID);
    const quantity = csvNumber(row.quantity);
    if (blueprintId == null || activityId == null || typeId == null || quantity == null) continue;
    const key = activityKey(blueprintId, activityId);
    const probability = probabilities.get(`${blueprintId}:${activityId}:${typeId}`);
    const list = productsByActivity.get(key) ?? [];
    list.push({ typeId, quantity: Math.round(quantity), ...(probability != null ? { probability } : {}) });
    productsByActivity.set(key, list);
    noteActivity(blueprintId, activityId);
  }

  const materialsByActivity = new Map<string, Array<{ typeId: number; quantity: number }>>();
  for (const row of loadCsv('industryActivityMaterials.csv')) {
    const blueprintId = csvNumber(row.typeID);
    const activityId = csvNumber(row.activityID);
    const typeId = csvNumber(row.materialTypeID);
    const quantity = csvNumber(row.quantity);
    if (blueprintId == null || activityId == null || typeId == null || quantity == null) continue;
    const key = activityKey(blueprintId, activityId);
    const list = materialsByActivity.get(key) ?? [];
    list.push({ typeId, quantity: Math.round(quantity) });
    materialsByActivity.set(key, list);
    noteActivity(blueprintId, activityId);
  }

  const skillsByActivity = new Map<string, Array<{ skillId: number; level: number }>>();
  for (const row of loadCsv('industryActivitySkills.csv')) {
    const blueprintId = csvNumber(row.typeID);
    const activityId = csvNumber(row.activityID);
    const skillId = csvNumber(row.skillID);
    const level = csvNumber(row.level);
    if (blueprintId == null || activityId == null || skillId == null || level == null) continue;
    const key = activityKey(blueprintId, activityId);
    const list = skillsByActivity.get(key) ?? [];
    list.push({ skillId, level: Math.round(level) });
    skillsByActivity.set(key, list);
    noteActivity(blueprintId, activityId);
  }

  function activityFor(blueprintId: number, activityId: number): OutIndustryActivity | null {
    const key = activityKey(blueprintId, activityId);
    const time = times.get(key);
    if (time == null) return null;
    const requiredSkills = (skillsByActivity.get(key) ?? []).map(skill => {
      const skillType = types.get(skill.skillId);
      usedSkillIds.add(skill.skillId);
      return {
        skillId: skill.skillId,
        name: skillType?.name ?? `Skill ${skill.skillId}`,
        level: skill.level,
        rank: skillRankFromAttrs(skill.skillId, attrsByType),
      };
    });
    return {
      activityId,
      timeSeconds: time,
      materials: (materialsByActivity.get(key) ?? []).map(material => ({
        typeId: material.typeId,
        name: types.get(material.typeId)?.name ?? `Type ${material.typeId}`,
        quantity: material.quantity,
      })),
      products: (productsByActivity.get(key) ?? []).map(product => ({
        typeId: product.typeId,
        name: types.get(product.typeId)?.name ?? `Type ${product.typeId}`,
        quantity: product.quantity,
        ...(product.probability != null ? { probability: product.probability } : {}),
      })),
      requiredSkills,
    };
  }

  for (const [key, products] of productsByActivity) {
    const [blueprintIdText, activityIdText] = key.split(':');
    const blueprintId = Number(blueprintIdText);
    const activityId = Number(activityIdText);
    if (activityId !== 1) continue;
    const blueprintType = types.get(blueprintId);
    if (!blueprintType?.published) continue;
    const product = products.find(p => types.get(p.typeId)?.published);
    if (!product) continue;
    const productType = types.get(product.typeId);
    const time = times.get(activityKey(blueprintId, 1));
    if (time == null) continue;

    const requiredSkills = (skillsByActivity.get(activityKey(blueprintId, 1)) ?? []).map(skill => {
      const skillType = types.get(skill.skillId);
      usedSkillIds.add(skill.skillId);
      return {
        skillId: skill.skillId,
        name: skillType?.name ?? `Skill ${skill.skillId}`,
        level: skill.level,
        rank: skillRankFromAttrs(skill.skillId, attrsByType),
      };
    });

    industryBlueprints[String(blueprintId)] = {
      blueprintId,
      blueprintName: blueprintType.name,
      productTypeId: product.typeId,
      productName: productType?.name ?? `Type ${product.typeId}`,
      productQuantity: product.quantity,
      baseTimeSeconds: time,
      materials: (materialsByActivity.get(activityKey(blueprintId, 1)) ?? []).map(material => ({
        typeId: material.typeId,
        name: types.get(material.typeId)?.name ?? `Type ${material.typeId}`,
        quantity: material.quantity,
      })),
      requiredSkills,
    };
  }

  for (const [blueprintId, activityIds] of activityIdsByBlueprint) {
    const existing = industryBlueprints[String(blueprintId)];
    if (!existing) continue;
    const activities: Record<string, OutIndustryActivity> = {};
    for (const activityId of Array.from(activityIds).sort((a, b) => a - b)) {
      const activity = activityFor(blueprintId, activityId);
      if (activity) activities[String(activityId)] = activity;
    }
    existing.activities = activities;
  }

  const skillQueue = Array.from(usedSkillIds);
  for (let i = 0; i < skillQueue.length; i++) {
    const skillId = skillQueue[i];
    for (const required of extractRequiredSkillsFromAttrs(attrsByType.get(skillId))) {
      if (usedSkillIds.has(required.skillId)) continue;
      usedSkillIds.add(required.skillId);
      skillQueue.push(required.skillId);
    }
  }

  for (const sid of usedSkillIds) {
    const type = types.get(sid);
    const attrs = attrsByType.get(sid);
    if (!type || !attrs) continue;
    skillsOut[String(sid)] = {
      name: type.name,
      rank: Math.round(attrs.get(ATTR_SKILL_RANK) ?? 1),
      primary: attrs.has(ATTR_PRIMARY) ? Math.round(attrs.get(ATTR_PRIMARY)!) : null,
      secondary: attrs.has(ATTR_SECONDARY) ? Math.round(attrs.get(ATTR_SECONDARY)!) : null,
      requiredSkills: extractRequiredSkillsFromAttrs(attrs),
    };
  }

  return { fuzzFiles };
}

async function main() {
  const stamp = await fetchSdeIfNeeded();
  const fuzzStamp = await fetchFuzzworkCsvIfNeeded([
    'invCategories.csv',
    'invGroups.csv',
    'invTypes.csv',
    'dgmTypeAttributes.csv',
    'industryActivity.csv',
    'industryActivityProducts.csv',
    'industryActivityMaterials.csv',
    'industryActivitySkills.csv',
    'industryActivityProbabilities.csv',
  ]);

  const categories = loadYaml<Record<string, { name: { en: string }; published?: boolean }>>(
    SDE_ZIP, 'fsd/categories.yaml',
  );
  const categoryNames = new Map<number, string>();
  for (const [cid, c] of Object.entries(categories)) {
    categoryNames.set(Number(cid), c.name?.en ?? `Category ${cid}`);
  }

  const groups = loadYaml<Record<string, SdeGroup>>(SDE_ZIP, 'fsd/groups.yaml');
  const shipGroupIds = new Set<number>();
  const groupNames = new Map<number, string>();
  const groupCategory = new Map<number, number>();
  for (const [gid, g] of Object.entries(groups)) {
    const id = Number(gid);
    groupNames.set(id, g.name?.en ?? `Group ${id}`);
    groupCategory.set(id, g.categoryID);
    if (g.categoryID === SHIP_CATEGORY_ID && g.published) shipGroupIds.add(id);
  }
  console.log(`[parse]   ${shipGroupIds.size} ship groups, ${groups ? Object.keys(groups).length : 0} groups total`);

  const types = loadYaml<Record<string, SdeType>>(SDE_ZIP, 'fsd/types.yaml');
  const typeDogma = loadYaml<Record<string, SdeTypeDogma>>(SDE_ZIP, 'fsd/typeDogma.yaml');
  const certificates = loadYaml<Record<string, Cert>>(SDE_ZIP, 'fsd/certificates.yaml');
  const blueprints = loadYaml<Record<string, SdeBlueprint>>(SDE_ZIP, 'fsd/blueprints.yaml');

  // 1) Ships (with masteries) and 2) Items (modules/drones/charges/etc. — direct skill prereqs only)
  const ships: Record<string, OutShip> = {};
  const items: Record<string, OutItem> = {};
  const usedSkillIds = new Set<number>();

  // Categories we explicitly exclude from `items`: ships (already in `ships`),
  // skills themselves (16), blueprints (9 — too many, derived from products),
  // SKINs (91), and abstract things like Celestial (2)/Region (3)/etc.
  const ITEM_EXCLUDE_CATEGORIES = new Set<number>([6, 9, 16, 91, 1, 2, 3, 4, 5, 10, 11, 14, 19, 26, 27, 29, 30]);

  for (const [tid, t] of Object.entries(types)) {
    if (!t.published) continue;
    const groupId = t.groupID;
    const categoryId = groupCategory.get(groupId);
    const required = extractRequiredSkills(typeDogma[tid]);

    if (shipGroupIds.has(groupId)) {
      const masteries = shapeMasteries(t.masteries);
      if (required.length === 0 && masteries.every(m => m.length === 0)) continue;
      ships[tid] = {
        name: t.name?.en ?? `Type ${tid}`,
        groupId,
        groupName: groupNames.get(groupId) ?? `Group ${groupId}`,
        requiredSkills: required,
        masteries,
      };
      for (const r of required) usedSkillIds.add(r.skillId);
      continue;
    }

    // Items: published, has at least one skill prereq, not in excluded categories.
    if (required.length === 0) continue;
    if (categoryId == null || ITEM_EXCLUDE_CATEGORIES.has(categoryId)) continue;

    items[tid] = {
      name: t.name?.en ?? `Type ${tid}`,
      groupId,
      groupName: groupNames.get(groupId) ?? `Group ${groupId}`,
      categoryId,
      categoryName: categoryNames.get(categoryId) ?? `Category ${categoryId}`,
      requiredSkills: required,
    };
    for (const r of required) usedSkillIds.add(r.skillId);
  }
  console.log(`[ships]   ${Object.keys(ships).length} published ships`);
  console.log(`[items]   ${Object.keys(items).length} published items`);

  // 3) Manufacturing blueprints: compact product/material/skill data for Industry tab.
  const industryBlueprints: Record<string, OutIndustryBlueprint> = {};
  for (const [bid, bp] of Object.entries(blueprints)) {
    const blueprintType = types[bid];
    if (!blueprintType?.published) continue;
    const manufacturing = bp.activities?.manufacturing;
    if (!manufacturing?.products?.length || manufacturing.time == null) continue;

    const product = manufacturing.products.find(p => types[String(p.typeID)]?.published);
    if (!product) continue;

    const requiredSkills = (manufacturing.skills ?? []).map(s => {
      const skillType = types[String(s.typeID)];
      const skillId = Number(s.typeID);
      usedSkillIds.add(skillId);
      return {
        skillId,
        name: skillType?.name?.en ?? `Skill ${skillId}`,
        level: Math.round(s.level),
        rank: skillRank(skillId, typeDogma),
      };
    });

    industryBlueprints[bid] = {
      blueprintId: Number(bid),
      blueprintName: blueprintType.name?.en ?? `Blueprint ${bid}`,
      productTypeId: Number(product.typeID),
      productName: types[String(product.typeID)]?.name?.en ?? `Type ${product.typeID}`,
      productQuantity: Math.round(product.quantity),
      baseTimeSeconds: Math.round(manufacturing.time),
      materials: (manufacturing.materials ?? []).map(m => ({
        typeId: Number(m.typeID),
        name: types[String(m.typeID)]?.name?.en ?? `Type ${m.typeID}`,
        quantity: Math.round(m.quantity),
      })),
      requiredSkills,
    };
  }
  console.log(`[industry] ${Object.keys(industryBlueprints).length} manufacturing blueprints`);

  // 2) Certificates (only those referenced by any ship's masteries — keeps file lean)
  const referencedCertIds = new Set<number>();
  for (const ship of Object.values(ships)) {
    for (const lv of ship.masteries) for (const c of lv) referencedCertIds.add(c);
  }

  const certs: Record<string, OutCert> = {};
  for (const cid of referencedCertIds) {
    const c = certificates[String(cid)];
    if (!c) continue;
    const skills: OutCert['skills'] = [];
    for (const [sid, gradeMap] of Object.entries(c.skillTypes)) {
      const skillId = Number(sid);
      const levels = MASTERY_GRADES.map(g => gradeMap[g] ?? 0) as [number, number, number, number, number];
      skills.push({ skillId, levels });
      usedSkillIds.add(skillId);
    }
    certs[String(cid)] = { name: c.name, skills };
  }
  console.log(`[certs]   ${Object.keys(certs).length} certificates`);

  // 3) Skills metadata (only the skills we actually reference)
  const skillsOut: Record<string, OutSkill> = {};
  for (const sid of usedSkillIds) {
    const t = types[String(sid)];
    const d = typeDogma[String(sid)];
    if (!t) continue;
    const attrs = new Map<number, number>();
    for (const a of d?.dogmaAttributes ?? []) attrs.set(a.attributeID, a.value);
    skillsOut[String(sid)] = {
      name: t.name?.en ?? `Skill ${sid}`,
      rank: Math.round(attrs.get(ATTR_SKILL_RANK) ?? 1),
      primary: attrs.has(ATTR_PRIMARY) ? Math.round(attrs.get(ATTR_PRIMARY)!) : null,
      secondary: attrs.has(ATTR_SECONDARY) ? Math.round(attrs.get(ATTR_SECONDARY)!) : null,
      requiredSkills: extractRequiredSkills(typeDogma[String(sid)]),
    };
  }
  console.log(`[skills]  ${Object.keys(skillsOut).length} referenced skills`);

  const { fuzzFiles } = overlayFuzzworkData(ships, items, industryBlueprints, skillsOut, usedSkillIds);
  console.log(`[fuzzwork] overlaid ${fuzzFiles.length} current CSV tables`);
  console.log(`[ships]   ${Object.keys(ships).length} current ships after overlay`);
  console.log(`[items]   ${Object.keys(items).length} current items after overlay`);
  console.log(`[industry] ${Object.keys(industryBlueprints).length} current manufacturing blueprints after overlay`);
  console.log(`[skills]  ${Object.keys(skillsOut).length} current referenced skills after overlay`);

  const out = {
    _meta: {
      built_at: new Date().toISOString(),
      sde_etag: stamp.etag,
      sde_last_modified: stamp.lastModified,
      sde_url: SDE_URL,
      fuzzwork_csv_url: FUZZWORK_CSV_BASE,
      fuzzwork_last_modified: fuzzStamp.files['invTypes.csv']?.lastModified ?? null,
      counts: {
        ships: Object.keys(ships).length,
        items: Object.keys(items).length,
        industryBlueprints: Object.keys(industryBlueprints).length,
        certificates: Object.keys(certs).length,
        skills: Object.keys(skillsOut).length,
      },
    },
    ships,
    items,
    industry: { blueprints: industryBlueprints },
    certificates: certs,
    skills: skillsOut,
  };

  if (!existsSync(dirname(OUT_PATH))) mkdirSync(dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUT_PATH, json);
  const sha = createHash('sha256').update(json).digest('hex').slice(0, 16);
  console.log(`[done]    ${OUT_PATH}  (${(json.length / 1024).toFixed(1)} KB, sha256:${sha})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
