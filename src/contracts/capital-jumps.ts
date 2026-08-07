import type { ContractMapTopology } from './map.ts';

export const LIGHT_YEAR_METERS = 9_460_000_000_000_000;
const JDC5_COMBAT_CAPITAL_RANGE_LY = 5;

export function capitalJumpsAtJdc5(
  topology: ContractMapTopology,
  originSystemId: number,
  destinationSystemId: number,
): number | null {
  const origin = topology.systems.get(originSystemId);
  const destination = topology.systems.get(destinationSystemId);
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) return null;

  const distanceLy = Math.hypot(
    origin.x - destination.x,
    origin.y - destination.y,
    origin.z - destination.z,
  ) / LIGHT_YEAR_METERS;

  if (distanceLy === 0) return 0;
  return Math.ceil(distanceLy / JDC5_COMBAT_CAPITAL_RANGE_LY);
}

function hasCoordinates(
  system: { x?: number; y?: number; z?: number } | undefined,
): system is { x: number; y: number; z: number } {
  return system != null
    && Number.isFinite(system.x)
    && Number.isFinite(system.y)
    && Number.isFinite(system.z);
}
