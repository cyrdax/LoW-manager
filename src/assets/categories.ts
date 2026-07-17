import type { AssetCategoryInfo, AssetCategoryKey, AssetItemMetadata } from './types.ts';

export const ASSET_CATEGORY_LABELS: Record<AssetCategoryKey, string> = {
  ships: 'Ships',
  frigates: 'Frigates',
  cruisers: 'Cruisers',
  battleships: 'Battleships',
  capitals: 'Capitals',
  'mining-ships': 'Mining Ships',
  modules: 'Modules',
  'armor-modules': 'Armor Modules',
  'shield-modules': 'Shield Modules',
  scanning: 'Scanning Equipment',
  'cpu-powergrid': 'CPU/Powergrid Upgrades',
  'weapon-upgrades': 'Weapon Upgrades',
  implants: 'Implants',
  'drones-fighters': 'Drones/Fighters',
  ammo: 'Ammo',
  materials: 'Materials',
  minerals: 'Minerals',
  pi: 'PI',
  blueprints: 'Blueprints',
  other: 'Other',
};

const CAPITAL_GROUP_IDS = new Set([30, 485, 547, 659, 883, 1538, 4594]);
const MINING_SHIP_TYPE_IDS = new Set([32880]);
const MINING_SHIP_GROUP_IDS = new Set([463, 543, 941, 1283]);
const MINING_SHIP_GROUPS = new Set(['mining barge', 'exhumer', 'industrial command ship', 'expedition frigate']);
const ARMOR_MODULE_GROUP_IDS = new Set([62, 325, 326, 328, 329, 773, 1150, 1199]);
const SHIELD_MODULE_GROUP_IDS = new Set([38, 39, 40, 57, 77, 295, 338, 770, 774, 1156]);
const SCANNING_MODULE_GROUP_IDS = new Set([481, 1233]);
const CPU_POWERGRID_MODULE_GROUP_IDS = new Set([285, 766, 769]);
const WEAPON_UPGRADE_MODULE_GROUP_IDS = new Set([59, 205, 211, 302, 367, 645]);
const ARMOR_MODULE_GROUPS = new Set(['armor coating', 'armor hardener', 'armor repair unit', 'armor reinforcer', 'energized armor layer', 'reactive armor hardener']);
const SHIELD_MODULE_GROUPS = new Set(['shield booster', 'shield extender', 'shield hardener', 'shield recharger', 'shield flux coil', 'shield power relay']);
const SCANNING_MODULE_GROUPS = new Set(['rig scanning', 'scan probe launcher', 'core probe launcher', 'expanded probe launcher', 'data analyzer', 'relic analyzer']);
const CPU_POWERGRID_MODULE_GROUPS = new Set(['cpu enhancer', 'co-processor', 'power diagnostic system', 'reactor control unit', 'micro auxiliary power core']);
const WEAPON_UPGRADE_MODULE_GROUPS = new Set(['gyrostabilizer', 'heat sink', 'magnetic field stabilizer', 'ballistic control system', 'tracking enhancer', 'drone damage amplifier']);

export function categorizeAssetItem(meta: AssetItemMetadata): AssetCategoryInfo {
  const category = meta.categoryName.toLowerCase();
  const group = meta.groupName.toLowerCase();

  const primary = primaryCategory(meta, category, group);
  const rollups: AssetCategoryKey[] = [];
  if (category === 'ship' && primary !== 'ships') rollups.push('ships');
  if (category === 'module' && primary !== 'modules') rollups.push('modules');
  if ((category === 'material' || category === 'commodity') && primary !== 'materials') rollups.push('materials');

  return {
    key: primary,
    label: ASSET_CATEGORY_LABELS[primary],
    primary,
    rollups,
  };
}

function primaryCategory(meta: AssetItemMetadata, category: string, group: string): AssetCategoryKey {
  if (category === 'ship') {
    if (MINING_SHIP_TYPE_IDS.has(meta.typeId) || MINING_SHIP_GROUP_IDS.has(meta.groupId) || MINING_SHIP_GROUPS.has(group)) return 'mining-ships';
    if (group.includes('frigate')) return 'frigates';
    if (group.includes('cruiser')) return 'cruisers';
    if (group.includes('battlecruiser')) return 'cruisers';
    if (group.includes('battleship')) return 'battleships';
    if (CAPITAL_GROUP_IDS.has(meta.groupId)) return 'capitals';
    return 'ships';
  }
  if (category === 'implant') return 'implants';
  if (category === 'drone' || category === 'fighter') return 'drones-fighters';
  if (category === 'charge') return 'ammo';
  if (category === 'blueprint') return 'blueprints';
  if (group.includes('mineral')) return 'minerals';
  if (group.includes('planetary') || group.includes('commodity')) return 'pi';
  if (category === 'material') return 'materials';
  if (category === 'module') {
    if (SCANNING_MODULE_GROUP_IDS.has(meta.groupId) || SCANNING_MODULE_GROUPS.has(group)) return 'scanning';
    if (CPU_POWERGRID_MODULE_GROUP_IDS.has(meta.groupId) || CPU_POWERGRID_MODULE_GROUPS.has(group)) return 'cpu-powergrid';
    if (WEAPON_UPGRADE_MODULE_GROUP_IDS.has(meta.groupId) || WEAPON_UPGRADE_MODULE_GROUPS.has(group)) return 'weapon-upgrades';
    if (ARMOR_MODULE_GROUP_IDS.has(meta.groupId) || ARMOR_MODULE_GROUPS.has(group)) return 'armor-modules';
    if (SHIELD_MODULE_GROUP_IDS.has(meta.groupId) || SHIELD_MODULE_GROUPS.has(group)) return 'shield-modules';
    return 'modules';
  }
  return 'other';
}
