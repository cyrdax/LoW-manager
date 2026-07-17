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

const CAPITAL_GROUPS = ['carrier', 'dreadnought', 'force auxiliary', 'supercarrier', 'titan', 'capital industrial ship'];
const MINING_GROUPS = ['mining barge', 'exhumer', 'industrial command ship'];
const ARMOR_TERMS = ['armor', 'energized', 'plating', 'repairer'];
const SHIELD_TERMS = ['shield', 'booster', 'hardener', 'extender'];
const SCANNING_TERMS = ['scan', 'scanner', 'probe', 'analyzer', 'hacking', 'archaeology'];
const CPU_POWERGRID_TERMS = ['cpu', 'powergrid', 'power diagnostic', 'reactor control', 'micro auxiliary power core'];
const WEAPON_UPGRADE_TERMS = ['gyrostabilizer', 'heat sink', 'magnetic field stabilizer', 'ballistic control', 'tracking enhancer', 'damage amplifier'];

export function categorizeAssetItem(meta: AssetItemMetadata): AssetCategoryInfo {
  const category = meta.categoryName.toLowerCase();
  const group = meta.groupName.toLowerCase();
  const name = meta.name.toLowerCase();

  const primary = primaryCategory(category, group, name);
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

function primaryCategory(category: string, group: string, name: string): AssetCategoryKey {
  if (category === 'ship') {
    if (group.includes('frigate')) return 'frigates';
    if (group.includes('cruiser')) return 'cruisers';
    if (group.includes('battlecruiser')) return 'cruisers';
    if (group.includes('battleship')) return 'battleships';
    if (CAPITAL_GROUPS.some(term => group.includes(term))) return 'capitals';
    if (MINING_GROUPS.some(term => group.includes(term))) return 'mining-ships';
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
    if (SCANNING_TERMS.some(term => group.includes(term) || name.includes(term))) return 'scanning';
    if (CPU_POWERGRID_TERMS.some(term => group.includes(term) || name.includes(term))) return 'cpu-powergrid';
    if (WEAPON_UPGRADE_TERMS.some(term => group.includes(term) || name.includes(term))) return 'weapon-upgrades';
    if (ARMOR_TERMS.some(term => group.includes(term) || name.includes(term))) return 'armor-modules';
    if (SHIELD_TERMS.some(term => group.includes(term) || name.includes(term))) return 'shield-modules';
    return 'modules';
  }
  return 'other';
}
