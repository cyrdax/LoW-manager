import { esiGet, esiPost } from './client.ts';

export interface CharacterFleet {
  fleet_id: number;
  role: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member';
  squad_id: number;
  wing_id: number;
}

export interface FleetInvitation {
  character_id: number;
  role: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member';
  squad_id?: number;
  wing_id?: number;
}

export interface FleetSquad {
  id: number;
  name: string;
}

export interface FleetWing {
  id: number;
  name: string;
  squads: FleetSquad[];
}

export async function getCharacterFleet(characterId: number): Promise<CharacterFleet | null> {
  try {
    const { data } = await esiGet<CharacterFleet>(`/characters/${characterId}/fleet/`, characterId);
    return data;
  } catch (err) {
    const e = err as { status?: number };
    if (e.status === 404) return null;
    throw err;
  }
}

export async function getFleetWings(fleetId: number, bossCharacterId: number): Promise<FleetWing[]> {
  const { data } = await esiGet<FleetWing[]>(`/fleets/${fleetId}/wings/`, bossCharacterId);
  return data;
}

export async function createWing(fleetId: number, bossCharacterId: number): Promise<number> {
  const { data } = await esiPost<{ wing_id: number }>(`/fleets/${fleetId}/wings/`, bossCharacterId, {});
  return data.wing_id;
}

export async function createSquad(fleetId: number, wingId: number, bossCharacterId: number): Promise<number> {
  const { data } = await esiPost<{ squad_id: number }>(`/fleets/${fleetId}/wings/${wingId}/squads/`, bossCharacterId, {});
  return data.squad_id;
}

/** Find (or create) a real wing+squad on the fleet suitable for squad_member invites. */
export async function ensureSquad(fleetId: number, bossCharacterId: number): Promise<{ wingId: number; squadId: number }> {
  let wings = await getFleetWings(fleetId, bossCharacterId);
  let wing = wings.find(w => w.squads.length > 0) ?? wings[0];

  if (!wing) {
    const wingId = await createWing(fleetId, bossCharacterId);
    const squadId = await createSquad(fleetId, wingId, bossCharacterId);
    return { wingId, squadId };
  }
  if (wing.squads.length === 0) {
    const squadId = await createSquad(fleetId, wing.id, bossCharacterId);
    return { wingId: wing.id, squadId };
  }
  return { wingId: wing.id, squadId: wing.squads[0].id };
}

export async function inviteMember(fleetId: number, bossCharacterId: number, invite: FleetInvitation): Promise<void> {
  await esiPost(`/fleets/${fleetId}/members/`, bossCharacterId, invite);
}
