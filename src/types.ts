export interface CharacterRow {
  character_id: number;
  character_name: string;
  owner_hash: string;
  scopes: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: number | null;
  added_at: number;
  needs_reauth: 0 | 1;
  is_boss: 0 | 1;
}

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
  // ISO date when the *last* queued skill finishes (i.e. when queue runs dry).
  // Empty string "" = polled and queue is empty. null = not polled yet.
  trainingQueueEnd: string | null;
  totalSp: number | null;
  unallocatedSp: number | null;
  implantNames: string[];
  fleetId: number | null;
  fleetRole: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member' | null;
  fleetWingId: number | null;
  fleetSquadId: number | null;
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
