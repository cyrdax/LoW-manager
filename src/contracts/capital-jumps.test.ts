import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTopologyFromSystems } from './map.ts';
import {
  extractJumpDriveStaticData,
  jumpDriveJumpsAtJdc5,
  jumpDriveRangeAtJdc5,
  jumpFuelUnitsAtJfc5,
  LIGHT_YEAR_METERS,
} from './capital-jumps.ts';

test('capitalJumpsAtJdc5 returns zero for contracts in the origin system', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
  ]);

  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 30000142, 3.5), 0);
});

test('jumpDriveJumpsAtJdc5 uses the searched ship base range with Jump Drive Calibration V', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
    system(30000145, 'Perimeter', 6.934 * LIGHT_YEAR_METERS, 0, 0),
    system(30000148, 'Urlen', 7.01 * LIGHT_YEAR_METERS, 0, 0),
  ]);

  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 30000145, 3.5), 1);
  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 30000148, 3.5), 2);
  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 30000148, 5), 1);
});

test('jumpDriveJumpsAtJdc5 returns null when the searched ship has no jump drive', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
    system(30000145, 'Perimeter', 1 * LIGHT_YEAR_METERS, 0, 0),
  ]);

  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 30000145, null), null);
});

test('jumpDriveJumpsAtJdc5 returns null when either system lacks coordinates', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
    { systemId: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge', neighbors: [] },
  ]);

  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 30000145, 3.5), null);
  assert.equal(jumpDriveJumpsAtJdc5(topology, 30000142, 99999999, 3.5), null);
});

test('jumpDriveRangeAtJdc5 doubles a ship base jump range', () => {
  assert.equal(jumpDriveRangeAtJdc5(3.5), 7);
  assert.equal(jumpDriveRangeAtJdc5(5), 10);
  assert.equal(jumpDriveRangeAtJdc5(null), null);
});

test('jumpFuelUnitsAtJfc5 returns the rounded-up isotope need for direct light-year distance', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
    system(30000148, 'Urlen', 6.934 * LIGHT_YEAR_METERS, 0, 0),
  ]);
  assert.equal(jumpFuelUnitsAtJfc5(topology, 30000142, 30000148, 3_000), 10_401);
});

test('extractJumpDriveStaticData reads range and isotope consumption from dogma attributes', () => {
  assert.deepEqual(extractJumpDriveStaticData(new Map([
    [861, 1],
    [866, 16_274],
    [867, 3.5],
    [868, 3_000],
  ]), typeId => typeId === 16_274 ? 'Helium Isotopes' : null), {
    jumpDriveBaseRangeLy: 3.5,
    jumpFuelTypeId: 16_274,
    jumpFuelTypeName: 'Helium Isotopes',
    jumpFuelUnitsPerLy: 3_000,
  });
});

function system(systemId: number, name: string, x: number, y: number, z: number) {
  return {
    systemId,
    name,
    regionId: 10000002,
    regionName: 'The Forge',
    neighbors: [],
    x,
    y,
    z,
  };
}
