// Static PI metadata. Keyed by name (not type_id) so we don't have to maintain
// a fragile mapping table — the existing resolveType() cache gives us names.
//
// Coverage: P0 + P1 are exhaustive (15 each). P2 is included for inventory tier
// classification. P3/P4 fall through to "P3+" since they're rarely stockpiled
// on-planet — pilots typically haul those off.

import type { PlanetType } from './planets.ts';

/** P0 raw materials extractable from each planet type. */
export const PLANET_RESOURCES: Record<PlanetType, string[]> = {
  temperate: ['Aqueous Liquids', 'Autotrophs', 'Carbon Compounds', 'Complex Organisms', 'Micro Organisms'],
  barren:    ['Aqueous Liquids', 'Base Metals', 'Carbon Compounds', 'Micro Organisms', 'Noble Metals'],
  oceanic:   ['Aqueous Liquids', 'Carbon Compounds', 'Complex Organisms', 'Micro Organisms', 'Planktic Colonies'],
  ice:       ['Aqueous Liquids', 'Heavy Metals', 'Micro Organisms', 'Noble Gas', 'Planktic Colonies'],
  gas:       ['Aqueous Liquids', 'Base Metals', 'Ionic Solutions', 'Noble Gas', 'Reactive Gas'],
  lava:      ['Base Metals', 'Felsic Magma', 'Heavy Metals', 'Non-Cs Crystals', 'Suspended Plasma'],
  storm:     ['Base Metals', 'Ionic Solutions', 'Noble Gas', 'Reactive Gas', 'Suspended Plasma'],
  plasma:    ['Base Metals', 'Heavy Metals', 'Noble Metals', 'Non-Cs Crystals', 'Suspended Plasma'],
};

/** P0 → P1 refinement (1:1 schematic). */
export const P0_TO_P1: Record<string, string> = {
  'Aqueous Liquids':   'Water',
  'Autotrophs':        'Industrial Fibers',
  'Base Metals':       'Reactive Metals',
  'Carbon Compounds':  'Biofuels',
  'Complex Organisms': 'Proteins',
  'Felsic Magma':      'Silicon',
  'Heavy Metals':      'Toxic Metals',
  'Ionic Solutions':   'Electrolytes',
  'Micro Organisms':   'Bacteria',
  'Noble Gas':         'Oxygen',
  'Noble Metals':      'Precious Metals',
  'Non-Cs Crystals':   'Chiral Structures',
  'Planktic Colonies': 'Biomass',
  'Reactive Gas':      'Oxidizing Compound',
  'Suspended Plasma':  'Plasmoids',
};

export type PiTier = 'P0' | 'P1' | 'P2' | 'P3+';

const P0_NAMES = new Set(Object.keys(P0_TO_P1));
const P1_NAMES = new Set(Object.values(P0_TO_P1));

const P2_NAMES = new Set([
  'Biocells', 'Construction Blocks', 'Consumer Electronics', 'Coolant',
  'Enriched Uranium', 'Fertilizer', 'Genetically Enhanced Livestock', 'Livestock',
  'Mechanical Parts', 'Microfiber Shielding', 'Miniature Electronics', 'Nanites',
  'Oxides', 'Polyaramids', 'Polytextiles', 'Rocket Fuel', 'Silicate Glass',
  'Superconductors', 'Supertensile Plastics', 'Synthetic Oil', 'Test Cultures',
  'Transmitter', 'Viral Agent',
]);

export function classifyTier(name: string): PiTier {
  if (P0_NAMES.has(name)) return 'P0';
  if (P1_NAMES.has(name)) return 'P1';
  if (P2_NAMES.has(name)) return 'P2';
  return 'P3+';
}

export interface ExtractablePair { p0: string; p1: string }

export function extractablesFor(planetType: PlanetType | string): ExtractablePair[] {
  const list = PLANET_RESOURCES[planetType as PlanetType];
  if (!list) return [];
  return list.map(p0 => ({ p0, p1: P0_TO_P1[p0] ?? p0 }));
}
