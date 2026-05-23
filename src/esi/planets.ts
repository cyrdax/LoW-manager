import { esiGet } from './client.ts';

export type PlanetType = 'temperate' | 'barren' | 'oceanic' | 'ice' | 'gas' | 'lava' | 'storm' | 'plasma';

export interface PlanetSummary {
  planet_id: number;
  planet_type: PlanetType;
  solar_system_id: number;
  owner_id: number;
  upgrade_level: number;        // 0–5 (Command Center upgrade)
  num_pins: number;             // total structures
  last_update: string;          // ISO when colony layout last edited
}

export interface PlanetPin {
  pin_id: number;
  type_id: number;
  schematic_id?: number;
  latitude: number;
  longitude: number;
  // Extractor head pins have these:
  expiry_time?: string;
  install_time?: string;
  cycle_time?: number;
  head_radius?: number;
  product_type_id?: number;
  // Factory pins have last_cycle_start.
  last_cycle_start?: string;
  contents?: Array<{ type_id: number; amount: number }>;
}

export interface PlanetDetail {
  links: Array<{ source_pin_id: number; destination_pin_id: number; link_level: number }>;
  pins: PlanetPin[];
  routes: Array<{
    route_id: number;
    source_pin_id: number;
    destination_pin_id: number;
    content_type_id: number;
    quantity: number;
    waypoints?: number[];
  }>;
}

export const getPlanets = (id: number) => esiGet<PlanetSummary[]>(`/characters/${id}/planets/`, id);

export const getPlanetDetail = (characterId: number, planetId: number) =>
  esiGet<PlanetDetail>(`/characters/${characterId}/planets/${planetId}/`, characterId);

/** Earliest extractor expiry across all pins, or null if no extractors are running. */
export function soonestExpiry(pins: PlanetPin[]): string | null {
  let min: string | null = null;
  for (const p of pins) {
    if (!p.expiry_time) continue;
    if (!min || p.expiry_time < min) min = p.expiry_time;
  }
  return min;
}

/** True if any extractor's expiry has already passed. */
export function hasIdleExtractor(pins: PlanetPin[]): boolean {
  const now = new Date().toISOString();
  for (const p of pins) {
    if (p.expiry_time && p.expiry_time <= now) return true;
  }
  return false;
}
