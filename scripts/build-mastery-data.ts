/**
 * Build script: extracts ship/cert/skill data from CCP's SDE into a single
 * compact JSON the app loads at runtime. Run after each CCP release.
 *
 *   npm run build:mastery
 *
 * Output: data/eve-mastery.json (~250KB).
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
const CACHE_DIR = resolve(ROOT, '.cache');
const SDE_ZIP = resolve(CACHE_DIR, 'sde.zip');
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

function unzipToString(zipPath: string, member: string): string {
  // System unzip handles the 153MB types.yaml without needing a JS zip lib.
  return execSync(`unzip -p "${zipPath}" "${member}"`, { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

function loadYaml<T>(zipPath: string, member: string): T {
  console.log(`[parse] ${member}`);
  const text = unzipToString(zipPath, member);
  return yaml.load(text) as T;
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

async function main() {
  const stamp = await fetchSdeIfNeeded();

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
    };
  }
  console.log(`[skills]  ${Object.keys(skillsOut).length} referenced skills`);

  const out = {
    _meta: {
      built_at: new Date().toISOString(),
      sde_etag: stamp.etag,
      sde_last_modified: stamp.lastModified,
      sde_url: SDE_URL,
      counts: {
        ships: Object.keys(ships).length,
        items: Object.keys(items).length,
        certificates: Object.keys(certs).length,
        skills: Object.keys(skillsOut).length,
      },
    },
    ships,
    items,
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
