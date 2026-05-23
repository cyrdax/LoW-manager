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
  trainingQueueEnd: string | null;
  totalSp: number | null;
  unallocatedSp: number | null;
  implantNames: string[];
  interplanetaryConsolidation: number | null;
  colonies: ColonyInfo[];
  nextPiExpiry: string | null;
  hasIdlePi: boolean;
  fleetId: number | null;
  fleetRole: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member' | null;
  fleetWingId: number | null;
  fleetSquadId: number | null;
  isBoss: boolean;
  needsReauth: boolean;
  updatedAt: number;
}

export interface ColonyInfo {
  planetId: number;
  planetType: string;
  solarSystemId: number;
  solarSystemName: string | null;
  upgradeLevel: number;
  numPins: number;
  lastUpdate: string;
  soonestExpiry: string | null;
  hasIdle: boolean;
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
  fleet: {
    fleet_id: number;
    role: string;
    wing_id: number;
    squad_id: number;
    fleet_boss_id?: number;
  } | null;
  wings: FleetWing[];
  error?: string;
}

export async function fetchFleetStructure(): Promise<FleetStructure> {
  const res = await fetch('/api/fleet/structure');
  if (!res.ok) return { fleet: null, wings: [], error: res.statusText };
  return res.json();
}

export async function moveToSquad(
  characterIds: number[],
  target: InviteTarget,
  actorCharacterId?: number,
): Promise<{ target?: InviteTarget; results: InviteResult[]; error?: string }> {
  const res = await fetch('/api/fleet/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_ids: characterIds,
      ...target,
      ...(actorCharacterId ? { actor_character_id: actorCharacterId } : {}),
    }),
  });
  if (!res.ok) return { results: [], error: (await res.json()).error ?? res.statusText };
  return res.json();
}

export interface FleetRosterMember {
  characterId: number;
  characterName: string;
  shipTypeId: number;
  shipTypeName: string;
  solarSystemId: number;
  solarSystemName: string;
  stationId: number | null;
  takesFleetWarp: boolean;
  role: 'fleet_commander' | 'wing_commander' | 'squad_commander' | 'squad_member';
  roleName: string;
  wingId: number;
  squadId: number;
  joinTime: string;
}

export interface FleetRoster {
  actor: { characterId: number; name: string };
  fleet: { fleet_id: number; role: string; wing_id: number; squad_id: number; fleet_boss_id?: number } | null;
  wings: FleetWing[];
  members: FleetRosterMember[];
  error?: string;
}

export async function fetchFleetRoster(actorCharacterId?: number): Promise<FleetRoster> {
  const url = actorCharacterId
    ? `/api/fleet/roster?actor=${actorCharacterId}`
    : '/api/fleet/roster';
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      actor: { characterId: actorCharacterId ?? 0, name: '' },
      fleet: null,
      wings: [],
      members: [],
      error: body.error ?? res.statusText,
    };
  }
  return res.json();
}

export async function kickFromFleet(
  characterId: number,
  actorCharacterId?: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/fleet/kick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_id: characterId,
      ...(actorCharacterId ? { actor_character_id: actorCharacterId } : {}),
    }),
  });
  if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return { ok: true };
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

export interface SystemPlanetMyColony {
  characterId: number;
  characterName: string;
  upgradeLevel: number;
  numPins: number;
  soonestExpiry: string | null;
  hasIdle: boolean;
}

export interface ExtractablePair { p0: string; p1: string }

export interface SystemPlanet {
  planetId: number;
  name: string;
  planetType: string;
  extractables: ExtractablePair[];
  myColonies: SystemPlanetMyColony[];
}

export interface SystemPlanetsResponse {
  system: { id: number; name: string; securityStatus: number };
  planets: SystemPlanet[];
}

export async function fetchSystemPlanets(systemId: number): Promise<SystemPlanetsResponse | { error: string }> {
  const res = await fetch(`/api/planets/system/${systemId}`);
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

export type PiTier = 'P0' | 'P1' | 'P2' | 'P3+';

export interface ColonyExtractor {
  pinId: number;
  typeName: string;
  productName: string | null;
  expiryTime: string | null;
  installTime: string | null;
  cycleSeconds: number | null;
}
export interface ColonyFactory {
  pinId: number;
  typeName: string;
  schematicName: string | null;
  lastCycleStart: string | null;
}
export interface ColonyStorage {
  pinId: number;
  typeName: string;
  contents: Array<{ name: string; tier: PiTier; amount: number }>;
}
export interface ColonyDetail {
  characterId: number;
  planetId: number;
  fetchedAt: number;
  extractors: ColonyExtractor[];
  factories: ColonyFactory[];
  storage: ColonyStorage[];
}

export async function fetchColonyDetail(
  characterId: number,
  planetId: number,
): Promise<ColonyDetail | { error: string }> {
  const res = await fetch(`/api/planets/colony/${characterId}/${planetId}`);
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

export interface InventoryLocation {
  characterId: number;
  characterName: string;
  planetId: number;
  amount: number;
}
export interface InventoryItem {
  tier: PiTier;
  name: string;
  total: number;
  locations: InventoryLocation[];
}
export async function fetchInventory(): Promise<{ items: InventoryItem[] }> {
  const res = await fetch('/api/planets/inventory');
  if (!res.ok) return { items: [] };
  return res.json();
}

export interface SavedSystem {
  systemId: number;
  systemName: string;
  securityStatus: number;
  planets: SystemPlanet[];
  savedAt: number;
  error?: string;
}

export async function fetchSavedSystems(): Promise<SavedSystem[]> {
  const res = await fetch('/api/planets/saved');
  if (!res.ok) return [];
  const body = await res.json();
  return body.systems ?? [];
}

export async function saveSystem(systemId: number): Promise<void> {
  await fetch('/api/planets/saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_id: systemId }),
  });
}

export async function unsaveSystem(systemId: number): Promise<void> {
  await fetch(`/api/planets/saved/${systemId}`, { method: 'DELETE' });
}

export interface ShipHit { id: number; name: string; groupName: string }
export interface ItemHit { id: number; name: string; groupName: string; categoryName: string }

export async function searchShips(q: string, signal?: AbortSignal): Promise<ShipHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/skills/ships?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function searchItems(q: string, signal?: AbortSignal): Promise<ItemHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/skills/items?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export interface PlanSkillSource {
  kind: 'ship-prereq' | 'mastery';
  certId?: number;
  certName?: string;
}

export interface PlanSkill {
  skillId: number;
  name: string;
  rank: number;
  currentLevel: number;
  currentSp: number;
  targetLevel: number;
  targetSp: number;
  spGap: number;
  sources: PlanSkillSource[];
}

export interface SkillPlan {
  ship: { id: number; name: string; groupName: string };
  masteryLevel: number;
  characterId: number;
  characterTotalSp: number;
  skills: PlanSkill[];
  totals: { totalSpGap: number; skillsToTrain: number; skillsMet: number; totalSkills: number };
}

export async function fetchSkillPlan(
  characterId: number,
  shipId: number,
  masteryLevel: number,
): Promise<SkillPlan | { error: string }> {
  const res = await fetch(`/api/skills/plan?characterId=${characterId}&shipId=${shipId}&masteryLevel=${masteryLevel}`);
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

export interface ItemPlan {
  item: { id: number; name: string; groupName: string; categoryName: string };
  characterId: number;
  characterTotalSp: number;
  skills: PlanSkill[];
  totals: { totalSpGap: number; skillsToTrain: number; skillsMet: number; totalSkills: number };
}

export async function fetchItemPlan(
  characterId: number,
  itemId: number,
): Promise<ItemPlan | { error: string }> {
  const res = await fetch(`/api/skills/item-plan?characterId=${characterId}&itemId=${itemId}`);
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

export interface SdeStatus {
  current: string | null;
  latest: string | null;
  latestLastModified?: string | null;
  stale: boolean;
  reachable: boolean;
}

export async function fetchSdeStatus(): Promise<SdeStatus> {
  const res = await fetch('/api/skills/sde-status');
  if (!res.ok) return { current: null, latest: null, stale: false, reachable: false };
  return res.json();
}

export interface MasteryMeta {
  built_at: string;
  sde_etag: string | null;
  sde_last_modified: string | null;
  counts: { ships: number; certificates: number; skills: number };
}

export async function fetchMasteryMeta(): Promise<MasteryMeta | null> {
  const res = await fetch('/api/skills/meta');
  if (!res.ok) return null;
  const body = await res.json();
  return body.meta ?? null;
}

export interface SavedSkillPlan {
  id: number;
  characterId: number;
  shipId: number;
  shipName: string;
  groupName: string;
  masteryLevel: number;
  label: string | null;
  savedAt: number;
}

export async function fetchSavedSkillPlans(characterId?: number): Promise<SavedSkillPlan[]> {
  const url = characterId ? `/api/skills/plans?characterId=${characterId}` : '/api/skills/plans';
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

export async function saveSkillPlan(
  characterId: number,
  shipId: number,
  masteryLevel: number,
  label?: string,
): Promise<void> {
  await fetch('/api/skills/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_id: characterId,
      ship_id: shipId,
      mastery_level: masteryLevel,
      label: label ?? null,
    }),
  });
}

export async function deleteSkillPlan(id: number): Promise<void> {
  await fetch(`/api/skills/plans/${id}`, { method: 'DELETE' });
}

export async function openInClient(
  characterId: number,
  typeId: number,
  kind: 'info' | 'market',
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/skills/open-window', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id: characterId, type_id: typeId, kind }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? res.statusText };
  }
  return { ok: true };
}

export interface PlexHistoryEntry {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  volume: number;
  order_count: number;
}

export interface PlexHistory {
  typeId: number;
  regionId: number;
  regionName: string;
  history: PlexHistoryEntry[];
}

export interface PlexOrders {
  typeId: number;
  regionId: number;
  regionName: string;
  bestSell: number | null;
  bestBuy: number | null;
  spread: number | null;
  sellVolume: number;
  buyVolume: number;
  sellOrders: number;
  buyOrders: number;
  fetchedAt: number;
}

export async function fetchPlexHistory(): Promise<PlexHistory | { error: string }> {
  const res = await fetch('/api/market/plex/history');
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

export async function fetchPlexOrders(): Promise<PlexOrders | { error: string }> {
  const res = await fetch('/api/market/plex/orders');
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
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

export type ShoppingHub = 'jita' | 'amarr';
export type ShoppingItemStatus = 'ok' | 'partial' | 'no-orders' | 'unknown-item';

export interface ShoppingItemQuote {
  inputName: string;
  resolvedName: string | null;
  typeId: number | null;
  requestedQty: number;
  filledQty: number;
  totalCost: number;
  avgPrice: number | null;
  shortfall: number;
  status: ShoppingItemStatus;
}

export interface ShoppingListQuote {
  hub: ShoppingHub;
  systemName: string;
  regionName: string;
  items: ShoppingItemQuote[];
  totalCost: number;
  counts: { ok: number; partial: number; noOrders: number; unknown: number };
  fetchedAt: number;
}

export async function quoteShoppingList(
  hub: ShoppingHub,
  items: Array<{ name: string; qty: number }>,
): Promise<ShoppingListQuote | { error: string }> {
  const res = await fetch('/api/market/shopping-list/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hub, items }),
  });
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}
