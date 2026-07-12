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

export interface CurrentUser {
  id: string;
  email: string | null;
  emailVerifiedAt?: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'disabled' | 'deleted';
  mainCharacterId?: number | null;
}

export type AuthResult = { user: CurrentUser; verificationSent?: boolean } | { error: string };

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  const body = await res.json() as { user: CurrentUser | null };
  return body.user;
}

export async function signup(email: string, password: string): Promise<AuthResult> {
  return jsonOrError(await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
}

export async function login(email: string, password: string): Promise<AuthResult> {
  return jsonOrError(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
}

export async function logout(): Promise<{ ok: true } | { error: string }> {
  return jsonOrError(await fetch('/api/auth/logout', { method: 'POST' }));
}

export async function requestEmailVerification(email: string): Promise<{ ok: true } | { error: string }> {
  return jsonOrError(await fetch('/api/auth/email/verify/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }));
}

export async function requestPasswordReset(email: string): Promise<{ ok: true } | { error: string }> {
  return jsonOrError(await fetch('/api/auth/password/reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }));
}

export async function completePasswordReset(token: string, password: string): Promise<{ ok: true } | { error: string }> {
  return jsonOrError(await fetch('/api/auth/password/reset/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  }));
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

export async function setMainCharacter(characterId: number | null): Promise<{ mainCharacterId: number | null } | { error: string }> {
  return jsonOrError(await fetch('/api/characters/main', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id: characterId }),
  }));
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

export interface ContractShipHit {
  id: number;
  name: string;
  groupName: string;
}

export interface ContractWarning {
  code: string;
  message: string;
  count?: number;
}

export interface ContractSearchResult {
  contractId: number;
  type: 'item_exchange' | 'auction';
  title: string;
  price: number | null;
  buyout: number | null;
  effectivePrice: number | null;
  quantity: number;
  shipTypeId: number;
  shipName: string;
  regionId: number;
  regionName: string;
  systemId: number | null;
  systemName: string | null;
  locationName: string;
  locationKnown: boolean;
  jumps: number | null;
  dateIssued: string;
  dateExpired: string;
}

export interface ContractSearchResponse {
  ship: ContractShipHit;
  origin: { id: number; name: string };
  radius: number;
  regionsScanned: Array<{ id: number; name: string }>;
  index: ContractIndexSummary;
  fetchedAt: number;
  results: ContractSearchResult[];
  warnings: ContractWarning[];
}

export interface ContractIndexSummary {
  complete: boolean;
  regionsTotal: number;
  regionsReady: number;
  regionsStale: number;
  regionsMissing: number;
  regionsQueued: number;
  oldestRefreshedAt: number | null;
  newestRefreshedAt: number | null;
  activeContracts: number;
  indexedItemContracts: number;
}

export async function searchContractShips(q: string, signal?: AbortSignal): Promise<ContractShipHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/contracts/ships?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function searchContracts(
  params: { shipId: number; originSystemId: number; radius: number },
  signal?: AbortSignal,
): Promise<ContractSearchResponse | { error: string }> {
  const qs = new URLSearchParams({
    shipId: String(params.shipId),
    originSystemId: String(params.originSystemId),
    radius: String(params.radius),
  });
  const res = await fetch(`/api/contracts/search?${qs.toString()}`, { signal });
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
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
  trainingSeconds: number;
  sources: PlanSkillSource[];
}

export interface SkillPlan {
  ship: { id: number; name: string; groupName: string };
  masteryLevel: number;
  characterId: number;
  characterTotalSp: number;
  skills: PlanSkill[];
  totals: { totalSpGap: number; totalTrainingSeconds: number; skillsToTrain: number; skillsMet: number; totalSkills: number };
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
  totals: { totalSpGap: number; totalTrainingSeconds: number; skillsToTrain: number; skillsMet: number; totalSkills: number };
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

export interface ShoppingListSendResult {
  ok: true;
  mailId: number | null;
  quote: ShoppingListQuote;
}

export async function sendShoppingList(
  hub: ShoppingHub,
  items: Array<{ name: string; qty: number }>,
  recipientCharacterId: number,
): Promise<ShoppingListSendResult | { error: string; reauthHint?: string | null }> {
  const res = await fetch('/api/market/shopping-list/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hub, items, recipientCharacterId }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { error: j.error ?? res.statusText, reauthHint: j.reauthHint ?? null };
  }
  return res.json();
}

export interface IndustryBlueprintHit {
  blueprintId: number;
  blueprintName: string;
  productTypeId: number;
  productName: string;
  productQuantity: number;
}

export interface IndustryQuote {
  blueprint: {
    blueprintId: number;
    blueprintName: string;
    productTypeId: number;
    productName: string;
    productQuantity: number;
  };
  inputs: { runs: number; me: number; te: number; characterId: 'max' | number };
  output: { typeId: number; name: string; quantity: number };
  time: { baseSeconds: number; adjustedSeconds: number; perRunSeconds: number };
  materials: Array<{ typeId: number; name: string; baseQuantity: number; adjustedQuantity: number }>;
  skills: Array<{
    skillId: number;
    name: string;
    rank: number;
    requiredLevel: number;
    currentLevel: number;
    currentSp: number;
    targetSp: number;
    spGap: number;
    trainingSeconds: number;
    met: boolean;
  }>;
  totals: { totalSpGap: number; totalTrainingSeconds: number; missingSkills: number; totalSkills: number };
}

export interface IndustryPlanBonuses {
  manufacturingTimeBonus: number;
  manufacturingMaterialBonus: number;
  inventionTimeBonus: number;
  copyingTimeBonus: number;
  reactionTimeBonus: number;
  reactionMaterialBonus: number;
  jobFeeBonus: number;
  facilityTax: number;
}

export interface IndustryPlan {
  target: { blueprintId: number; blueprintName: string; productTypeId: number; productName: string; quantity: number };
  assumptions: {
    buildInputs: boolean;
    supportMe: number;
    supportTe: number;
    decryptor: {
      key: string;
      name: string;
      probabilityMultiplier: number;
      runModifier: number;
      meModifier: number;
      teModifier: number;
    };
    inventionOutput: { me: number; te: number; runsPerSuccessfulBpc: number } | null;
    bonuses: IndustryPlanBonuses;
  };
  invention: {
    sourceBlueprintId: number;
    sourceBlueprintName: string;
    chance: number;
    successfulBpcsNeeded: number;
    expectedAttempts: number;
    copyRunsNeeded: number;
    materialsPerAttempt: Array<{ typeId: number; name: string; quantity: number }>;
    expectedMaterials: Array<{ typeId: number; name: string; quantity: number }>;
  } | null;
  jobs: Array<{
    activityId: number;
    activityName: string;
    blueprintId: number;
    blueprintName: string;
    productTypeId: number | null;
    productName: string;
    runs: number;
    baseSeconds: number;
    adjustedSeconds: number;
    systemCostIndex: number | null;
    estimatedInstallFee: number | null;
  }>;
  materials: {
    final: Array<{ typeId: number; name: string; quantity: number }>;
    raw: Array<{ typeId: number; name: string; quantity: number }>;
  };
  skills: Array<{
    skillId: number;
    name: string;
    rank: number;
    requiredLevel: number;
    currentLevel: number;
    currentSp: number;
    targetSp: number;
    spGap: number;
    trainingSeconds: number;
    met: boolean;
  }>;
  totals: {
    jobSeconds: number;
    skillTrainingSeconds: number;
    totalSerialSeconds: number;
    estimatedInstallFees: number | null;
    rawMaterialLines: number;
    jobs: number;
  };
  system: { systemId: number; systemName: string; costIndices: Array<{ activity: string; cost_index: number }> } | null;
}

export async function searchIndustryBlueprints(q: string, signal?: AbortSignal): Promise<IndustryBlueprintHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/industry/blueprints?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchIndustryQuote(params: {
  blueprintId: number;
  characterId: 'max' | number;
  runs: number;
  me: number;
  te: number;
}): Promise<IndustryQuote | { error: string }> {
  const qs = new URLSearchParams({
    blueprintId: String(params.blueprintId),
    characterId: String(params.characterId),
    runs: String(params.runs),
    me: String(params.me),
    te: String(params.te),
  });
  const res = await fetch(`/api/industry/quote?${qs.toString()}`);
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

export async function fetchIndustryPlan(params: {
  blueprintId: number;
  characterId: 'max' | number;
  runs: number;
  systemId?: number | null;
  buildInputs: boolean;
  supportMe: number;
  supportTe: number;
  decryptor: string;
  bonuses: IndustryPlanBonuses;
}): Promise<IndustryPlan | { error: string }> {
  const qs = new URLSearchParams({
    blueprintId: String(params.blueprintId),
    characterId: String(params.characterId),
    runs: String(params.runs),
    buildInputs: String(params.buildInputs),
    supportMe: String(params.supportMe),
    supportTe: String(params.supportTe),
    decryptor: params.decryptor,
    manufacturingTimeBonus: String(params.bonuses.manufacturingTimeBonus),
    manufacturingMaterialBonus: String(params.bonuses.manufacturingMaterialBonus),
    inventionTimeBonus: String(params.bonuses.inventionTimeBonus),
    copyingTimeBonus: String(params.bonuses.copyingTimeBonus),
    reactionTimeBonus: String(params.bonuses.reactionTimeBonus),
    reactionMaterialBonus: String(params.bonuses.reactionMaterialBonus),
    jobFeeBonus: String(params.bonuses.jobFeeBonus),
    facilityTax: String(params.bonuses.facilityTax),
  });
  if (params.systemId) qs.set('systemId', String(params.systemId));
  const res = await fetch(`/api/industry/plan?${qs.toString()}`);
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error ?? res.statusText };
  return res.json();
}

// --- Fits ---

export type FitHub = 'jita' | 'amarr';
export type FitSectionRole =
  | 'low'
  | 'mid'
  | 'high'
  | 'rig'
  | 'service'
  | 'subsystem'
  | 'droneBay'
  | 'fighterBay'
  | 'extras'
  | 'unmatched';

export interface FitWarning {
  code: string;
  message: string;
  inputName?: string;
  count?: number;
}

export interface FitShip {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
}

export interface FitShipLayout {
  shipTypeId: number;
  shipName: string;
  highSlots: number;
  midSlots: number;
  lowSlots: number;
  rigSlots: number;
  serviceSlots: number;
  subsystemSlots: number;
  warnings: FitWarning[];
}

export interface AssignedFitItem {
  id: string;
  source: 'fit-line' | 'loaded-charge';
  sectionIndex: number;
  lineIndex: number;
  rawLine: string;
  inputName: string;
  resolvedName: string | null;
  typeId: number | null;
  quantity: number;
  role: FitSectionRole;
  slotFlag: string | null;
  warning: FitWarning | null;
}

export interface AssignedFitSection {
  role: FitSectionRole;
  label: string;
  slotCount: number;
  emptySlots: number;
  items: AssignedFitItem[];
}

export interface FitDraft {
  rawEft: string;
  fitName: string;
  headerShipName: string;
  ship: FitShip | null;
  layout: FitShipLayout | null;
  sections: Record<FitSectionRole, AssignedFitSection>;
  items: AssignedFitItem[];
  warnings: FitWarning[];
  normalizedEft: string;
}

export type LibraryVisibility = 'private' | 'public';

export interface SavedFitDetail extends FitDraft {
  id: number;
  ownerUserId: string | null;
  visibility: LibraryVisibility;
  sourcePublicFitId: number | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedFitSummary {
  id: number;
  ownerUserId: string | null;
  visibility: LibraryVisibility;
  sourcePublicFitId: number | null;
  shipTypeId: number;
  shipName: string;
  fitName: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  itemCount: number;
  warningCounts: { unmatched: number; overSlot: number; unassignable: number };
}

export interface DoctrineFitMember extends SavedFitSummary {
  sortOrder: number;
}

export interface DoctrineSummary {
  id: number;
  ownerUserId: string | null;
  visibility: LibraryVisibility;
  sourcePublicDoctrineId: number | null;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  fitCount: number;
  shipNames: string[];
}

export interface DoctrineDetail extends DoctrineSummary {
  fits: DoctrineFitMember[];
}

export interface FitQuoteItem {
  inputName: string;
  resolvedName: string | null;
  typeId: number | null;
  requestedQty: number;
  filledQty: number;
  totalCost: number;
  avgPrice: number | null;
  shortfall: number;
  status: 'ok' | 'partial' | 'no-orders' | 'unknown-item';
  bucket: 'hull' | 'fitted' | 'extras';
}

export interface FitQuote {
  hub: FitHub;
  systemName: string;
  regionName: string;
  items: FitQuoteItem[];
  totalCost: number;
  totals: { hull: number; fitted: number; extras: number; grand: number };
  counts: { ok: number; partial: number; noOrders: number; unknown: number };
  fetchedAt: number;
}

export interface FitShipHit { id: number; name: string; groupName: string }

async function jsonOrError<T>(res: Response): Promise<T | { error: string; reauthHint?: string | null }> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error ?? res.statusText, reauthHint: body.reauthHint ?? null };
  }
  return res.json();
}

export async function fetchFits(visibility: LibraryVisibility = 'private'): Promise<SavedFitSummary[]> {
  const qs = new URLSearchParams({ visibility });
  const res = await fetch(`/api/fits?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDoctrines(q = '', visibility: LibraryVisibility = 'private', fitId?: number): Promise<DoctrineSummary[]> {
  const qs = new URLSearchParams({ visibility });
  if (q.trim()) qs.set('q', q.trim());
  if (fitId != null) qs.set('fitId', String(fitId));
  const res = await fetch(`/api/doctrines?${qs}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchDoctrine(id: number): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}`));
}

export async function createDoctrine(input: { name: string; description?: string; visibility?: LibraryVisibility }): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch('/api/doctrines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function updateDoctrine(
  id: number,
  input: { name?: string; description?: string },
): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function deleteDoctrine(id: number): Promise<{ ok: true } | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}`, { method: 'DELETE' }));
}

export async function addDoctrineFit(id: number, fitId: number): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}/fits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fitId }),
  }));
}

export async function removeDoctrineFit(id: number, fitId: number): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}/fits/${fitId}`, { method: 'DELETE' }));
}

export async function publishDoctrine(id: number): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}/publish`, { method: 'POST' }));
}

export async function copyDoctrineToPrivate(id: number): Promise<DoctrineDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/doctrines/${id}/copy-private`, { method: 'POST' }));
}

export async function fetchFit(id: number): Promise<SavedFitDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/fits/${id}`));
}

export async function previewFit(rawEft: string, shipTypeId?: number): Promise<FitDraft | { error: string }> {
  return jsonOrError(await fetch('/api/fits/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawEft, shipTypeId }),
  }));
}

export async function saveFit(input: {
  rawEft: string;
  shipTypeId?: number;
  fitName?: string;
  notes?: string;
  visibility?: LibraryVisibility;
}): Promise<SavedFitDetail | { error: string }> {
  return jsonOrError(await fetch('/api/fits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function updateFit(
  id: number,
  input: { rawEft?: string; shipTypeId?: number; fitName?: string; notes?: string },
): Promise<SavedFitDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/fits/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function deleteFit(id: number): Promise<{ ok: true } | { error: string }> {
  return jsonOrError(await fetch(`/api/fits/${id}`, { method: 'DELETE' }));
}

export async function publishFit(id: number): Promise<SavedFitDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/fits/${id}/publish`, { method: 'POST' }));
}

export async function copyFitToPrivate(id: number): Promise<SavedFitDetail | { error: string }> {
  return jsonOrError(await fetch(`/api/fits/${id}/copy-private`, { method: 'POST' }));
}

export async function searchFitShips(q: string, signal?: AbortSignal): Promise<FitShipHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/fits/ships?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  return res.json();
}

export async function quoteSavedFit(id: number, hub: FitHub): Promise<FitQuote | { error: string }> {
  return jsonOrError(await fetch(`/api/fits/${id}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hub }),
  }));
}

export async function quoteDraftFit(
  rawEft: string,
  hub: FitHub,
  shipTypeId?: number,
): Promise<FitQuote | { error: string }> {
  return jsonOrError(await fetch('/api/fits/quote-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawEft, hub, shipTypeId }),
  }));
}

export async function sendSavedFit(
  id: number,
  characterId: number,
): Promise<{ ok: true; fittingId: number | null; excludedCount: number; warnings: FitWarning[] } | { error: string; reauthHint?: string | null }> {
  return jsonOrError(await fetch(`/api/fits/${id}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId }),
  }));
}

export async function sendDraftFit(
  rawEft: string,
  characterId: number,
  input?: { shipTypeId?: number; fitName?: string; notes?: string },
): Promise<{ ok: true; fittingId: number | null; excludedCount: number; warnings: FitWarning[] } | { error: string; reauthHint?: string | null }> {
  return jsonOrError(await fetch('/api/fits/send-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawEft, characterId, ...input }),
  }));
}
