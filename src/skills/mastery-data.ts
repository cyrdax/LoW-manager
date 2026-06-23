/**
 * Loads the bundled SDE-derived mastery data once at startup. Consumers read
 * via the exported getter rather than re-parsing the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MasteryShip {
  name: string;
  groupId: number;
  groupName: string;
  requiredSkills: Array<{ skillId: number; level: number }>;
  masteries: number[][]; // 5 entries (Mastery I..V) of cert ID arrays
}

export interface MasteryItem {
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  requiredSkills: Array<{ skillId: number; level: number }>;
}

export interface MasteryCert {
  name: string;
  skills: Array<{ skillId: number; levels: [number, number, number, number, number] }>;
}

export interface MasterySkill {
  name: string;
  rank: number;
  primary: number | null;
  secondary: number | null;
  requiredSkills?: Array<{ skillId: number; level: number }>;
}

export interface IndustryActivityData {
  activityId: number;
  timeSeconds: number;
  materials: Array<{ typeId: number; name: string; quantity: number }>;
  products: Array<{ typeId: number; name: string; quantity: number; probability?: number }>;
  requiredSkills: Array<{ skillId: number; name: string; level: number; rank: number }>;
}

export interface IndustryBlueprintData {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
  baseTimeSeconds: number;
  materials: Array<{ typeId: number; name: string; quantity: number }>;
  requiredSkills: Array<{ skillId: number; name: string; level: number; rank: number }>;
  activities?: Record<string, IndustryActivityData>;
}

export interface MasteryData {
  _meta: {
    built_at: string;
    sde_etag: string | null;
    sde_last_modified: string | null;
    sde_url: string;
    fuzzwork_csv_url?: string;
    fuzzwork_last_modified?: string | null;
    counts: { ships: number; items?: number; industryBlueprints?: number; certificates: number; skills: number };
  };
  ships: Record<string, MasteryShip>;
  items: Record<string, MasteryItem>;
  industry?: {
    blueprints: Record<string, IndustryBlueprintData>;
  };
  certificates: Record<string, MasteryCert>;
  skills: Record<string, MasterySkill>;
}

let cached: MasteryData | null = null;

function dataPath(): string {
  // src/skills/mastery-data.ts → ../../data/eve-mastery.json
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'eve-mastery.json');
}

export function loadMasteryData(): MasteryData {
  if (cached) return cached;
  const path = dataPath();
  if (!existsSync(path)) {
    throw new Error(`mastery data missing at ${path} — run \`npm run build:mastery\``);
  }
  cached = JSON.parse(readFileSync(path, 'utf8')) as MasteryData;
  return cached;
}

export function masteryDataMaybe(): MasteryData | null {
  try { return loadMasteryData(); } catch { return null; }
}
