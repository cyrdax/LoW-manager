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

export async function inviteAll(characterIds?: number[]): Promise<{ fleet_id?: number; results: InviteResult[]; error?: string }> {
  const res = await fetch('/api/fleet/invite-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(characterIds ? { character_ids: characterIds } : {}),
  });
  if (!res.ok) return { results: [], error: (await res.json()).error ?? res.statusText };
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
