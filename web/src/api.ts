export interface CharacterStatus {
  characterId: number;
  name: string;
  corporationId: number | null;
  corporationName: string | null;
  corporationTicker: string | null;
  portraitUrl: string;
  online: boolean | null;
  lastLogin: string | null;
  lastLogout: string | null;
  locationSystemId: number | null;
  locationSystemName: string | null;
  locationStationId: number | null;
  locationStationName: string | null;
  locationStructureId: number | null;
  shipTypeId: number | null;
  shipTypeName: string | null;
  shipName: string | null;
  walletBalance: number | null;
  trainingSkillId: number | null;
  trainingSkillName: string | null;
  trainingLevel: number | null;
  trainingFinishDate: string | null;
  totalSp: number | null;
  unallocatedSp: number | null;
  implantNames: string[];
  fleetId: number | null;
  fleetRole: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member' | null;
  isBoss: boolean;
  needsReauth: boolean;
  updatedAt: number;
}

export interface InviteResult {
  characterId: number;
  name: string;
  ok: boolean;
  error?: string;
}

export async function fetchCharacters(): Promise<CharacterStatus[]> {
  const res = await fetch('/api/characters');
  if (!res.ok) throw new Error('Failed to load characters');
  return res.json();
}

export async function deleteCharacter(id: number): Promise<void> {
  await fetch(`/api/characters/${id}`, { method: 'DELETE' });
}

export async function setBoss(id: number): Promise<void> {
  await fetch('/api/boss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id: id }),
  });
}

export interface InviteTarget { wing_id: number; squad_id: number }

export async function inviteAll(
  characterIds?: number[],
  target?: InviteTarget,
): Promise<{ fleet_id?: number; results: InviteResult[]; error?: string }> {
  const body: Record<string, unknown> = {};
  if (characterIds) body.character_ids = characterIds;
  if (target) { body.wing_id = target.wing_id; body.squad_id = target.squad_id; }
  const res = await fetch('/api/fleet/invite-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { results: [], error: (await res.json()).error ?? res.statusText };
  return res.json();
}

export interface FleetSquad { id: number; name: string }
export interface FleetWing { id: number; name: string; squads: FleetSquad[] }
export interface FleetStructure {
  fleet: { fleet_id: number; role: string; wing_id: number; squad_id: number } | null;
  wings: FleetWing[];
  error?: string;
}

export async function fetchFleetStructure(): Promise<FleetStructure> {
  const res = await fetch('/api/fleet/structure');
  if (!res.ok) return { fleet: null, wings: [], error: res.statusText };
  return res.json();
}

export interface SystemHit { id: number; name: string }

export async function searchSystems(q: string, signal?: AbortSignal): Promise<SystemHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/search/systems?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export interface WaypointResult {
  characterId: number;
  name: string;
  ok: boolean;
  error?: string;
}

export async function setWaypointAll(destinationId: number, characterIds?: number[]): Promise<{ destination_id: number; results: WaypointResult[] }> {
  const res = await fetch('/api/autopilot/waypoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination_id: destinationId,
      clear_other_waypoints: true,
      only_online: true,
      ...(characterIds ? { character_ids: characterIds } : {}),
    }),
  });
  return res.json();
}
