import { esiGet, esiPost, esiPut } from './client.ts';

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

export class NoSquadError extends Error {
  kind: 'no-wings-visible' | 'no-squads-in-any-wing';
  constructor(message: string, kind: 'no-wings-visible' | 'no-squads-in-any-wing') {
    super(message);
    this.kind = kind;
  }
}

/**
 * Find an existing wing+squad on the fleet suitable for squad_member invites.
 *
 * Never creates wings or squads. Creating on the fly produces a duplicate when
 * ESI's fleet cache hasn't registered the freshly-formed fleet yet (wings GET
 * returns 404 for ~30–60s) — invitees end up in a squad the FC never set up.
 * Callers should surface NoSquadError by asking the user to wait / pick
 * explicitly once the dropdown populates.
 */
export async function ensureSquad(fleetId: number, bossCharacterId: number): Promise<{ wingId: number; squadId: number }> {
  const wings = await getFleetWings(fleetId, bossCharacterId);
  if (wings.length === 0) {
    throw new NoSquadError(
      'Fleet structure not yet visible to ESI. Wait 30–60s for ESI to register the fleet, then try again.',
      'no-wings-visible',
    );
  }
  const wingWithSquad = wings.find(w => w.squads.length > 0);
  if (!wingWithSquad) {
    throw new NoSquadError(
      'Fleet has no squads. Create one in-client (right-click the wing → Create Squad) then try again.',
      'no-squads-in-any-wing',
    );
  }
  return { wingId: wingWithSquad.id, squadId: wingWithSquad.squads[0].id };
}

export async function inviteMember(fleetId: number, bossCharacterId: number, invite: FleetInvitation): Promise<void> {
  await esiPost(`/fleets/${fleetId}/members/`, bossCharacterId, invite);
}

export interface MoveMemberPayload {
  role: FleetInvitation['role'];
  wing_id?: number;
  squad_id?: number;
}

export async function moveMember(
  fleetId: number,
  bossCharacterId: number,
  memberCharacterId: number,
  payload: MoveMemberPayload,
): Promise<void> {
  await esiPut(`/fleets/${fleetId}/members/${memberCharacterId}/`, bossCharacterId, payload);
}
