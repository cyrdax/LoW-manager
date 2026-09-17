import type { ContractMapTopology } from './map.ts';

export const LIGHT_YEAR_METERS = 9_460_000_000_000_000;
const JUMP_DRIVE_CALIBRATION_LEVEL_5_MULTIPLIER = 2;
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

function positiveNumber(value: number | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}
