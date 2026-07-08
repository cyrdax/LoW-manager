import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTopologyFromSystems,
  distancesFrom,
  locationForId,
  regionsWithin,
} from './map.ts';

test('distancesFrom computes shortest jumps within radius', () => {
  const topology = buildTopologyFromSystems([
    system(1, 'A', 10, 'Alpha', [2]),
    system(2, 'B', 10, 'Alpha', [1, 3, 4]),
    system(3, 'C', 20, 'Beta', [2]),
    system(4, 'D', 20, 'Beta', [2, 5]),
    system(5, 'E', 30, 'Gamma', [4]),
  ]);

  assert.deepEqual([...distancesFrom(topology, 1, 2).entries()].sort((a, b) => a[0] - b[0]), [
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 2],
  ]);
});

test('regionsWithin returns deduped sorted regions touched by distance map', () => {
  const topology = buildTopologyFromSystems([
    system(1, 'A', 10, 'Alpha', [2]),
    system(2, 'B', 10, 'Alpha', [1, 3]),
    system(3, 'C', 20, 'Beta', [2]),
  ]);
  const distances = distancesFrom(topology, 1, 2);

  assert.deepEqual(regionsWithin(topology, distances), [
    { id: 10, name: 'Alpha' },
    { id: 20, name: 'Beta' },
  ]);
});

test('locationForId resolves system IDs and station IDs', () => {
  const topology = buildTopologyFromSystems(
    [system(1, 'A', 10, 'Alpha', [])],
    [{ stationId: 60000001, stationName: 'A I - Test Station', solarSystemId: 1 }],
  );

  assert.deepEqual(locationForId(topology, 1), { systemId: 1, name: 'A' });
  assert.deepEqual(locationForId(topology, 60000001), { systemId: 1, name: 'A I - Test Station' });
  assert.equal(locationForId(topology, 99000001), null);
});

test('loadContractMap resolves Jita and Jita 4-4 from bundled SDE cache', async () => {
  const { loadContractMap } = await import('./map.ts');
  const topology = loadContractMap();
  const jita = locationForId(topology, 30000142);
  const jita44 = locationForId(topology, 60003760);

  assert.equal(jita?.name, 'Jita');
  assert.equal(jita44?.systemId, 30000142);
  assert.match(jita44?.name ?? '', /Jita/);
});

function system(systemId: number, name: string, regionId: number, regionName: string, neighbors: number[]) {
  return { systemId, name, regionId, regionName, neighbors };
}
