import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTopologyFromSystems } from './map.ts';
import { capitalJumpsAtJdc5, LIGHT_YEAR_METERS } from './capital-jumps.ts';

test('capitalJumpsAtJdc5 returns zero for contracts in the origin system', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
  ]);

  assert.equal(capitalJumpsAtJdc5(topology, 30000142, 30000142), 0);
});

test('capitalJumpsAtJdc5 rounds straight-line distance up to 5 light-year combat-capital jumps', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
    system(30000145, 'Perimeter', 4.5 * LIGHT_YEAR_METERS, 0, 0),
    system(30000148, 'Urlen', 10.1 * LIGHT_YEAR_METERS, 0, 0),
  ]);

  assert.equal(capitalJumpsAtJdc5(topology, 30000142, 30000145), 1);
  assert.equal(capitalJumpsAtJdc5(topology, 30000142, 30000148), 3);
});

test('capitalJumpsAtJdc5 returns null when either system lacks coordinates', () => {
  const topology = buildTopologyFromSystems([
    system(30000142, 'Jita', 0, 0, 0),
    { systemId: 30000145, name: 'Perimeter', regionId: 10000002, regionName: 'The Forge', neighbors: [] },
  ]);

  assert.equal(capitalJumpsAtJdc5(topology, 30000142, 30000145), null);
  assert.equal(capitalJumpsAtJdc5(topology, 30000142, 99999999), null);
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
