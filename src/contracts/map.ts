import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export interface ContractMapSystemInput {
  systemId: number;
  name: string;
  regionId: number;
  regionName: string;
  neighbors: number[];
}

export interface StationLocation {
  stationId: number;
  stationName: string;
  solarSystemId: number;
}

export interface ContractMapTopology {
  systems: Map<number, { id: number; name: string; regionId: number; regionName: string }>;
  adjacency: Map<number, number[]>;
  stations: Map<number, { stationId: number; stationName: string; solarSystemId: number }>;
}

interface SdeSolarSystemYaml {
  solarSystemID: number;
  stargates?: Record<string, { destination: number }>;
}

interface SdeRegionYaml {
  regionID: number;
}

interface SdeStationYaml {
  stationID: number;
  stationName: string;
  solarSystemID: number;
}

let cachedTopology: ContractMapTopology | null = null;

export function buildTopologyFromSystems(
  systems: ContractMapSystemInput[],
  stations: StationLocation[] = [],
): ContractMapTopology {
  const systemMap = new Map<number, { id: number; name: string; regionId: number; regionName: string }>();
  const adjacency = new Map<number, number[]>();
  const stationMap = new Map<number, { stationId: number; stationName: string; solarSystemId: number }>();

  for (const system of systems) {
    systemMap.set(system.systemId, {
      id: system.systemId,
      name: system.name,
      regionId: system.regionId,
      regionName: system.regionName,
    });
    adjacency.set(system.systemId, Array.from(new Set(system.neighbors)).sort((a, b) => a - b));
  }

  for (const station of stations) {
    stationMap.set(station.stationId, station);
  }

  return { systems: systemMap, adjacency, stations: stationMap };
}

export function distancesFrom(topology: ContractMapTopology, originSystemId: number, radius: number): Map<number, number> {
  if (!topology.systems.has(originSystemId)) {
    throw new Error(`origin system ${originSystemId} is not present in contract map topology`);
  }

  const distances = new Map<number, number>([[originSystemId, 0]]);
  const queue = [originSystemId];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const currentDistance = distances.get(current)!;
    if (currentDistance >= radius) continue;

    for (const next of topology.adjacency.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, currentDistance + 1);
      queue.push(next);
    }
  }

  return distances;
}

export function regionsWithin(
  topology: ContractMapTopology,
  distances: Map<number, number>,
): Array<{ id: number; name: string }> {
  const byId = new Map<number, string>();

  for (const systemId of distances.keys()) {
    const system = topology.systems.get(systemId);
    if (system) byId.set(system.regionId, system.regionName);
  }

  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function locationForId(
  topology: ContractMapTopology,
  locationId: number | null | undefined,
): { systemId: number; name: string } | null {
  if (locationId == null) return null;

  const system = topology.systems.get(locationId);
  if (system) return { systemId: system.id, name: system.name };

  const station = topology.stations.get(locationId);
  if (station) return { systemId: station.solarSystemId, name: station.stationName };

  return null;
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function sdeZipPath(): string {
  return resolve(repoRoot(), '.cache', 'sde.zip');
}

function unzipList(zipPath: string): string[] {
  return execFileSync('unzip', ['-Z', '-1', zipPath], { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function unzipYaml<T>(zipPath: string, member: string): T {
  const text = execFileSync('unzip', ['-p', zipPath, member], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  return yaml.load(text) as T;
}

function displayRegionName(pathPart: string): string {
  return pathPart
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

export function loadContractMap(): ContractMapTopology {
  if (cachedTopology) return cachedTopology;

  const zipPath = sdeZipPath();
  if (!existsSync(zipPath)) {
    throw new Error(`SDE map data missing at ${zipPath}; run \`npm run build:mastery\` to download the SDE cache`);
  }

  const members = unzipList(zipPath);
  const regionFiles = members.filter(member => member.startsWith('universe/eve/') && member.endsWith('/region.yaml'));
  const systemFiles = members.filter(member => member.startsWith('universe/eve/') && member.endsWith('/solarsystem.yaml'));
  const regionByFolder = new Map<string, { id: number; name: string }>();

  for (const regionFile of regionFiles) {
    const parts = regionFile.split('/');
    const regionFolder = parts[2];
    const region = unzipYaml<SdeRegionYaml>(zipPath, regionFile);
    regionByFolder.set(regionFolder, { id: region.regionID, name: displayRegionName(regionFolder) });
  }

  const systems: ContractMapSystemInput[] = [];
  const gateToSystem = new Map<number, number>();
  const systemGateDestinations = new Map<number, number[]>();

  for (const systemFile of systemFiles) {
    const parts = systemFile.split('/');
    const regionFolder = parts[2];
    const systemName = parts[4];
    const region = regionByFolder.get(regionFolder);
    if (!region) continue;

    const system = unzipYaml<SdeSolarSystemYaml>(zipPath, systemFile);
    const gateDestinations: number[] = [];

    for (const [gateIdRaw, gate] of Object.entries(system.stargates ?? {})) {
      const gateId = Number(gateIdRaw);
      gateToSystem.set(gateId, system.solarSystemID);
      gateDestinations.push(gate.destination);
    }

    systems.push({
      systemId: system.solarSystemID,
      name: systemName,
      regionId: region.id,
      regionName: region.name,
      neighbors: [],
    });
    systemGateDestinations.set(system.solarSystemID, gateDestinations);
  }

  for (const system of systems) {
    const neighbors = new Set<number>();

    for (const destinationGateId of systemGateDestinations.get(system.systemId) ?? []) {
      const destinationSystemId = gateToSystem.get(destinationGateId);
      if (destinationSystemId != null && destinationSystemId !== system.systemId) {
        neighbors.add(destinationSystemId);
      }
    }

    system.neighbors = [...neighbors];
  }

  const stationsRaw = unzipYaml<SdeStationYaml[]>(zipPath, 'bsd/staStations.yaml');
  cachedTopology = buildTopologyFromSystems(
    systems,
    stationsRaw.map(station => ({
      stationId: station.stationID,
      stationName: station.stationName,
      solarSystemId: station.solarSystemID,
    })),
  );

  return cachedTopology;
}
