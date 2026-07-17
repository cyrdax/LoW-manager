import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMasteryData } from '../skills/mastery-data.ts';
import type { FitItem, FitSectionRole, FitShip, FitShipLayout, FitShipSearchHit, FitWarning } from './types.ts';

const SLOT_ATTRS = {
  lowSlots: 12,
  midSlots: 13,
  highSlots: 14,
  rigSlots: 1137,
  serviceSlots: 2056,
  subsystemSlots: 1367,
} as const;

type SlotKey = keyof typeof SLOT_ATTRS;

interface MetadataCache {
  shipsByName: Map<string, FitShip>;
  shipsById: Map<number, FitShip>;
  itemsByName: Map<string, FitItem>;
  itemsById: Map<number, FitItem>;
  layoutsById: Map<number, Partial<Record<SlotKey, number>>>;
}

let cache: MetadataCache | null = null;

export function resolveShipByName(name: string): FitShip | null {
  return getCache().shipsByName.get(normalizeName(name)) ?? null;
}

export function resolveShipByTypeId(typeId: number): FitShip | null {
  return getCache().shipsById.get(typeId) ?? null;
}

export function resolveItemByName(name: string): FitItem | null {
  return getCache().itemsByName.get(normalizeName(name)) ?? null;
}

export function resolveItemByTypeId(typeId: number): FitItem | null {
  return getCache().itemsById.get(typeId) ?? null;
}

export function searchFitShips(query: string, limit = 20): FitShipSearchHit[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const hits = [...getCache().shipsById.values()].filter(ship => normalizeName(ship.name).includes(q));
  hits.sort((a, b) => {
    const an = normalizeName(a.name);
    const bn = normalizeName(b.name);
    const ap = an.startsWith(q) ? 0 : 1;
    const bp = bn.startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  return hits.slice(0, limit);
}

export function getShipLayout(shipTypeId: number): FitShipLayout {
  const ship = resolveShipByTypeId(shipTypeId);
  const values = getCache().layoutsById.get(shipTypeId) ?? {};
  const warnings: FitWarning[] = [];
  if (!ship) {
    warnings.push({
      code: 'metadata-missing',
      message: `No ship metadata found for type ${shipTypeId}.`,
    });
  }

  return {
    shipTypeId,
    shipName: ship?.name ?? `Type ${shipTypeId}`,
    highSlots: values.highSlots ?? 0,
    midSlots: values.midSlots ?? 0,
    lowSlots: values.lowSlots ?? 0,
    rigSlots: values.rigSlots ?? 0,
    serviceSlots: values.serviceSlots ?? 0,
    subsystemSlots: values.subsystemSlots ?? 0,
    warnings,
  };
}

export function classifyFitItem(item: FitItem | null): FitSectionRole | null {
  if (!item) return 'unmatched';
  const category = item.categoryName.toLowerCase();
  const group = item.groupName.toLowerCase();
  if (category === 'drone' || category === 'drones') return 'droneBay';
  if (category === 'fighter' || category === 'fighters') return 'fighterBay';
  if (group.includes('subsystem')) return 'subsystem';
  if (group.includes('service module') || group.includes('structure service')) return 'service';
  if (category === 'charge' || category === 'implant' || group === 'booster') return 'extras';
  return null;
}

function getCache(): MetadataCache {
  if (cache) return cache;
  const mastery = loadMasteryData();
  const shipsByName = new Map<string, FitShip>();
  const shipsById = new Map<number, FitShip>();
  const itemsByName = new Map<string, FitItem>();
  const itemsById = new Map<number, FitItem>();

  for (const [id, ship] of Object.entries(mastery.ships)) {
    const typeId = Number(id);
    const fitShip: FitShip = {
      typeId,
      name: ship.name,
      groupId: ship.groupId,
      groupName: ship.groupName,
    };
    shipsByName.set(normalizeName(ship.name), fitShip);
    shipsById.set(typeId, fitShip);
  }

  for (const [id, item] of Object.entries(mastery.items)) {
    const typeId = Number(id);
    const fitItem: FitItem = {
      typeId,
      name: item.name,
      groupId: item.groupId,
      groupName: item.groupName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
    };
    itemsByName.set(normalizeName(fitItem.name), fitItem);
    itemsById.set(typeId, fitItem);
  }

  supplementItemsFromFuzzwork(itemsByName, itemsById);

  cache = {
    shipsByName,
    shipsById,
    itemsByName,
    itemsById,
    layoutsById: loadLayouts(),
  };
  return cache;
}

function supplementItemsFromFuzzwork(itemsByName: Map<string, FitItem>, itemsById: Map<number, FitItem>): void {
  const groups = new Map<number, { categoryId: number; groupName: string }>();
  for (const row of readCsvRows('invGroups.csv')) {
    if (row[0] === 'groupID') continue;
    const groupId = Number(row[0]);
    const categoryId = Number(row[1]);
    if (!Number.isFinite(groupId) || !Number.isFinite(categoryId)) continue;
    groups.set(groupId, { categoryId, groupName: row[2] ?? '' });
  }

  const categories = new Map<number, string>();
  for (const row of readCsvRows('invCategories.csv')) {
    if (row[0] === 'categoryID') continue;
    const categoryId = Number(row[0]);
    if (!Number.isFinite(categoryId)) continue;
    categories.set(categoryId, row[1] ?? '');
  }

  for (const row of readCsvRows('invTypes.csv')) {
    if (row[0] === 'typeID') continue;
    if (row[10] !== '1') continue;
    const typeId = Number(row[0]);
    const groupId = Number(row[1]);
    const name = row[2] ?? '';
    if (!Number.isFinite(typeId) || !Number.isFinite(groupId) || !name) continue;
    const key = normalizeName(name);
    if (itemsByName.has(key)) continue;
    const group = groups.get(groupId);
    if (!group) continue;
    const item: FitItem = {
      typeId,
      name,
      groupId,
      groupName: group.groupName,
      categoryId: group.categoryId,
      categoryName: categories.get(group.categoryId) ?? '',
    };
    itemsByName.set(key, item);
    itemsById.set(typeId, item);
  }
}

function loadLayouts(): Map<number, Partial<Record<SlotKey, number>>> {
  const out = new Map<number, Partial<Record<SlotKey, number>>>();
  const attrToKey = new Map<number, SlotKey>(
    Object.entries(SLOT_ATTRS).map(([key, attr]) => [attr, key as SlotKey]),
  );
  for (const row of readCsvRows('dgmTypeAttributes.csv')) {
    if (row[0] === 'typeID') continue;
    const typeId = Number(row[0]);
    const attrId = Number(row[1]);
    const key = attrToKey.get(attrId);
    if (!key) continue;
    const raw = row[2] || row[3];
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    const current = out.get(typeId) ?? {};
    current[key] = value;
    out.set(typeId, current);
  }
  return out;
}

function readCsvRows(name: string): Iterable<string[]> {
  const path = resolve(process.cwd(), '.cache', 'fuzzwork', name);
  if (!existsSync(path)) throw new Error(`Fuzzwork cache missing at ${path}`);
  return parseCsvRows(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function* parseCsvRows(text: string): Iterable<string[]> {
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
