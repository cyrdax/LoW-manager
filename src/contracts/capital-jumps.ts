import type { ContractMapTopology } from './map.ts';

export const LIGHT_YEAR_METERS = 9_460_000_000_000_000;
const JUMP_FUEL_CONSERVATION_LEVEL_5_MULTIPLIER = 0.5;
const CAN_JUMP_ATTRIBUTE_ID = 861;
const JUMP_FUEL_TYPE_ATTRIBUTE_ID = 866;
const JUMP_DRIVE_RANGE_ATTRIBUTE_ID = 867;
const JUMP_FUEL_UNITS_PER_LY_ATTRIBUTE_ID = 868;

export interface JumpDriveStaticData {
  jumpDriveBaseRangeLy: number | null;
  jumpFuelTypeId: number | null;
  jumpFuelTypeName: string | null;
  jumpFuelUnitsPerLy: number | null;
}

export function extractJumpDriveStaticData(
  attributes: ReadonlyMap<number, number> | undefined,
  typeName: (typeId: number) => string | null | undefined,
): JumpDriveStaticData {
  const empty: JumpDriveStaticData = {
    jumpDriveBaseRangeLy: null,
    jumpFuelTypeId: null,
    jumpFuelTypeName: null,
    jumpFuelUnitsPerLy: null,
  };
  if (!attributes || attributes.get(CAN_JUMP_ATTRIBUTE_ID) !== 1) return empty;

  const range = positiveNumber(attributes.get(JUMP_DRIVE_RANGE_ATTRIBUTE_ID));
  const fuelType = positiveNumber(attributes.get(JUMP_FUEL_TYPE_ATTRIBUTE_ID));
  const unitsPerLy = positiveNumber(attributes.get(JUMP_FUEL_UNITS_PER_LY_ATTRIBUTE_ID));
  const jumpFuelTypeId = fuelType == null ? null : Math.round(fuelType);

  return {
    jumpDriveBaseRangeLy: range,
    jumpFuelTypeId,
    jumpFuelTypeName: jumpFuelTypeId == null ? null : typeName(jumpFuelTypeId) ?? null,
    jumpFuelUnitsPerLy: unitsPerLy,
  };
}

export function jumpDriveRangeAtJdc5(baseRangeLy: number | null | undefined): number | null {
  return jumpDriveRangeAtJdcLevel(baseRangeLy, 5);
}

export function jumpDriveRangeAtJdcLevel(
  baseRangeLy: number | null | undefined,
  jdcLevel: number,
): number | null {
  if (baseRangeLy == null || !Number.isFinite(baseRangeLy) || baseRangeLy <= 0) return null;
  if (!Number.isInteger(jdcLevel) || jdcLevel < 1 || jdcLevel > 5) return null;
  return baseRangeLy * (1 + jdcLevel * 0.2);
}

export function jumpDriveJumpsAtJdc5(
  topology: ContractMapTopology,
  originSystemId: number,
  destinationSystemId: number,
  baseRangeLy: number | null | undefined,
): number | null {
  return jumpDriveJumpsAtJdcLevel(topology, originSystemId, destinationSystemId, baseRangeLy, 5);
}

export function jumpDriveJumpsAtJdcLevel(
  topology: ContractMapTopology,
  originSystemId: number,
  destinationSystemId: number,
  baseRangeLy: number | null | undefined,
  jdcLevel: number,
): number | null {
  if (jumpDriveRangeAtJdcLevel(baseRangeLy, jdcLevel) == null) return null;
  return jumpDriveDistancesFrom(topology, originSystemId, baseRangeLy, jdcLevel, 5).get(destinationSystemId) ?? null;
}

export function jumpDriveDistancesFrom(
  topology: ContractMapTopology,
  originSystemId: number,
  baseRangeLy: number | null | undefined,
  jdcLevel: number,
  maxJumps: number,
): Map<number, number> {
  if (!topology.systems.has(originSystemId)) {
    throw new Error(`origin system ${originSystemId} is not present in contract map topology`);
  }

  const rangeLy = jumpDriveRangeAtJdcLevel(baseRangeLy, jdcLevel);
  const origin = topology.systems.get(originSystemId);
  if (rangeLy == null || !hasCoordinates(origin) || !Number.isInteger(maxJumps) || maxJumps < 0) {
    return new Map();
  }

  const rangeMeters = rangeLy * LIGHT_YEAR_METERS;
  const rangeSquared = rangeMeters * rangeMeters;
  const buckets = new Map<string, Array<{ id: number; x: number; y: number; z: number }>>();

  for (const system of topology.systems.values()) {
    if (!hasCoordinates(system)) continue;
    const key = coordinateBucketKey(system.x, system.y, system.z, rangeMeters);
    const bucket = buckets.get(key) ?? [];
    bucket.push(system);
    buckets.set(key, bucket);
  }

  const distances = new Map<number, number>([[originSystemId, 0]]);
  const queue = [originSystemId];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = topology.systems.get(queue[cursor]);
    const currentJumps = distances.get(queue[cursor]);
    if (!hasCoordinates(current) || currentJumps == null || currentJumps >= maxJumps) continue;

    const cellX = Math.floor(current.x / rangeMeters);
    const cellY = Math.floor(current.y / rangeMeters);
    const cellZ = Math.floor(current.z / rangeMeters);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const candidate of buckets.get(`${cellX + dx}:${cellY + dy}:${cellZ + dz}`) ?? []) {
            if (distances.has(candidate.id)) continue;
            const deltaX = current.x - candidate.x;
            const deltaY = current.y - candidate.y;
            const deltaZ = current.z - candidate.z;
            if (deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ > rangeSquared) continue;
            distances.set(candidate.id, currentJumps + 1);
            queue.push(candidate.id);
          }
        }
      }
    }
  }

  return distances;
}

export function jumpFuelUnitsAtJfc5(
  topology: ContractMapTopology,
  originSystemId: number,
  destinationSystemId: number,
  baseUnitsPerLy: number | null | undefined,
): number | null {
  if (baseUnitsPerLy == null || !Number.isFinite(baseUnitsPerLy) || baseUnitsPerLy <= 0) return null;

  const origin = topology.systems.get(originSystemId);
  const destination = topology.systems.get(destinationSystemId);
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) return null;

  const distanceLy = Math.hypot(
    origin.x - destination.x,
    origin.y - destination.y,
    origin.z - destination.z,
  ) / LIGHT_YEAR_METERS;

  return Math.ceil(distanceLy * baseUnitsPerLy * JUMP_FUEL_CONSERVATION_LEVEL_5_MULTIPLIER);
}

function hasCoordinates(
  system: { x?: number; y?: number; z?: number } | undefined,
): system is { x: number; y: number; z: number } {
  return system != null
    && Number.isFinite(system.x)
    && Number.isFinite(system.y)
    && Number.isFinite(system.z);
}

function coordinateBucketKey(x: number, y: number, z: number, size: number): string {
  return `${Math.floor(x / size)}:${Math.floor(y / size)}:${Math.floor(z / size)}`;
}

function positiveNumber(value: number | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}
