import type { ContractMapTopology } from './map.ts';

export const LIGHT_YEAR_METERS = 9_460_000_000_000_000;
const JUMP_DRIVE_CALIBRATION_LEVEL_5_MULTIPLIER = 2;

export function jumpDriveRangeAtJdc5(baseRangeLy: number | null | undefined): number | null {
  if (baseRangeLy == null || !Number.isFinite(baseRangeLy) || baseRangeLy <= 0) return null;
  return baseRangeLy * JUMP_DRIVE_CALIBRATION_LEVEL_5_MULTIPLIER;
}

export function jumpDriveJumpsAtJdc5(
  topology: ContractMapTopology,
  originSystemId: number,
  destinationSystemId: number,
  baseRangeLy: number | null | undefined,
): number | null {
  const rangeLy = jumpDriveRangeAtJdc5(baseRangeLy);
  if (rangeLy == null) return null;

  const origin = topology.systems.get(originSystemId);
  const destination = topology.systems.get(destinationSystemId);
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) return null;

  const distanceLy = Math.hypot(
    origin.x - destination.x,
    origin.y - destination.y,
    origin.z - destination.z,
  ) / LIGHT_YEAR_METERS;

  if (distanceLy === 0) return 0;
  return Math.ceil(distanceLy / rangeLy);
}

function hasCoordinates(
  system: { x?: number; y?: number; z?: number } | undefined,
): system is { x: number; y: number; z: number } {
  return system != null
    && Number.isFinite(system.x)
    && Number.isFinite(system.y)
    && Number.isFinite(system.z);
}
