import { db } from '../db.ts';
import type { CharacterRow, CharacterStatus } from '../types.ts';
import { getLocation, getOnline, getShip } from '../esi/location.ts';
import { getWallet } from '../esi/wallet.ts';
import { currentlyTraining, getImplants, getSkillQueue, getSkills } from '../esi/skills.ts';
import { getCharacterFleet } from '../esi/fleet.ts';
import { getCharacterPublic, resolveCorporation, resolveStation, resolveSystem, resolveType, resolveStructure } from '../esi/universe.ts';
import { bus } from './events.ts';

const MIN_POLL_MS = 5_000;
const MAX_POLL_MS = 120_000;

// Cache TTL fallbacks (seconds) when no Expires header arrives.
const FALLBACK_TTL = {
  location: 5,
  ship: 5,
  online: 60,
  wallet: 120,
  skills: 120,
  sp: 120,
  implants: 120,
  fleet: 5,
  corp: 3600,
};

interface FieldState {
  nextFetchAt: number;
}

interface CharacterState {
  location: FieldState;
  ship: FieldState;
  online: FieldState;
  wallet: FieldState;
  skills: FieldState;
  sp: FieldState;
  implants: FieldState;
  fleet: FieldState;
  corp: FieldState;
  cached: CharacterStatus;
}

const state = new Map<number, CharacterState>();
const timers = new Map<number, NodeJS.Timeout>();

export function snapshot(): CharacterStatus[] {
  return Array.from(state.values()).map(s => s.cached);
}

export function snapshotOne(id: number): CharacterStatus | null {
  return state.get(id)?.cached ?? null;
}

export function startPolling() {
  const rows = db.prepare('SELECT * FROM characters').all() as CharacterRow[];
  for (const r of rows) ensureCharacter(r);
  console.log(`[poller] tracking ${rows.length} characters`);
}

export function ensureCharacter(row: CharacterRow) {
  if (!state.has(row.character_id)) {
    state.set(row.character_id, {
      location: { nextFetchAt: 0 },
      ship: { nextFetchAt: 0 },
      online: { nextFetchAt: 0 },
      wallet: { nextFetchAt: 0 },
      skills: { nextFetchAt: 0 },
      fleet: { nextFetchAt: 0 },
      corp: { nextFetchAt: 0 },
      sp: { nextFetchAt: 0 },
      implants: { nextFetchAt: 0 },
      cached: blankStatus(row),
    });
    scheduleNext(row.character_id, 0);
  } else {
    const s = state.get(row.character_id)!;
    s.cached.name = row.character_name;
    s.cached.isBoss = row.is_boss === 1;
    s.cached.needsReauth = row.needs_reauth === 1;
  }
}

export function forgetCharacter(id: number) {
  state.delete(id);
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  bus.emit('removed', { characterId: id });
}

function blankStatus(row: CharacterRow): CharacterStatus {
  return {
    characterId: row.character_id,
    name: row.character_name,
    corporationId: null,
    corporationName: null,
    corporationTicker: null,
    portraitUrl: `https://images.evetech.net/characters/${row.character_id}/portrait?size=128`,
    online: null,
    lastLogin: null,
    lastLogout: null,
    locationSystemId: null,
    locationSystemName: null,
    locationStationId: null,
    locationStationName: null,
    locationStructureId: null,
    shipTypeId: null,
    shipTypeName: null,
    shipName: null,
    walletBalance: null,
    trainingSkillId: null,
    trainingSkillName: null,
    trainingLevel: null,
    trainingFinishDate: null,
    totalSp: null,
    unallocatedSp: null,
    implantNames: [],
    fleetId: null,
    fleetRole: null,
    isBoss: row.is_boss === 1,
    needsReauth: row.needs_reauth === 1,
    updatedAt: 0,
  };
}

function scheduleNext(id: number, delayMs: number) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => tick(id).catch(err => console.error(`[poll ${id}]`, err)), delayMs);
  timers.set(id, t);
}

async function tick(id: number) {
  const s = state.get(id);
  if (!s) return;

  const row = db.prepare('SELECT * FROM characters WHERE character_id = ?').get(id) as CharacterRow | undefined;
  if (!row) {
    forgetCharacter(id);
    return;
  }
  if (row.needs_reauth) {
    s.cached.needsReauth = true;
    emit(id, { needsReauth: true });
    scheduleNext(id, 30_000);
    return;
  }

  const now = Date.now();
  const updates: Partial<CharacterStatus> = {};
  let changed = false;

  try {
    if (now >= s.online.nextFetchAt) {
      const { data, expires } = await getOnline(id);
      s.online.nextFetchAt = expires ?? now + FALLBACK_TTL.online * 1000;
      if (s.cached.online !== data.online) { s.cached.online = data.online; updates.online = data.online; changed = true; }
      if (s.cached.lastLogin !== (data.last_login ?? null)) { s.cached.lastLogin = data.last_login ?? null; updates.lastLogin = s.cached.lastLogin; changed = true; }
      if (s.cached.lastLogout !== (data.last_logout ?? null)) { s.cached.lastLogout = data.last_logout ?? null; updates.lastLogout = s.cached.lastLogout; changed = true; }
    }

    if (now >= s.location.nextFetchAt) {
      const { data, expires } = await getLocation(id);
      s.location.nextFetchAt = expires ?? now + FALLBACK_TTL.location * 1000;
      if (s.cached.locationSystemId !== data.solar_system_id) {
        s.cached.locationSystemId = data.solar_system_id;
        updates.locationSystemId = data.solar_system_id;
        s.cached.locationSystemName = await resolveSystem(data.solar_system_id);
        updates.locationSystemName = s.cached.locationSystemName;
        changed = true;
      }
      const stationId = data.station_id ?? null;
      if (s.cached.locationStationId !== stationId) {
        s.cached.locationStationId = stationId;
        updates.locationStationId = stationId;
        s.cached.locationStationName = stationId ? await resolveStation(stationId) : null;
        updates.locationStationName = s.cached.locationStationName;
        changed = true;
      }
      const structureId = data.structure_id ?? null;
      if (s.cached.locationStructureId !== structureId) {
        s.cached.locationStructureId = structureId;
        updates.locationStructureId = structureId;
        if (structureId) {
          s.cached.locationStationName = await resolveStructure(structureId, id);
          updates.locationStationName = s.cached.locationStationName;
        }
        changed = true;
      }
    }

    if (now >= s.ship.nextFetchAt) {
      const { data, expires } = await getShip(id);
      s.ship.nextFetchAt = expires ?? now + FALLBACK_TTL.ship * 1000;
      if (s.cached.shipTypeId !== data.ship_type_id) {
        s.cached.shipTypeId = data.ship_type_id;
        updates.shipTypeId = data.ship_type_id;
        s.cached.shipTypeName = await resolveType(data.ship_type_id);
        updates.shipTypeName = s.cached.shipTypeName;
        changed = true;
      }
      if (s.cached.shipName !== data.ship_name) {
        s.cached.shipName = data.ship_name;
        updates.shipName = data.ship_name;
        changed = true;
      }
    }

    if (now >= s.wallet.nextFetchAt) {
      const { data, expires } = await getWallet(id);
      s.wallet.nextFetchAt = expires ?? now + FALLBACK_TTL.wallet * 1000;
      if (s.cached.walletBalance !== data) {
        s.cached.walletBalance = data;
        updates.walletBalance = data;
        changed = true;
      }
    }

    if (now >= s.skills.nextFetchAt) {
      const { data, expires } = await getSkillQueue(id);
      s.skills.nextFetchAt = expires ?? now + FALLBACK_TTL.skills * 1000;
      const training = currentlyTraining(data);
      const skillId = training?.skill_id ?? null;
      const level = training?.finished_level ?? null;
      const finish = training?.finish_date ?? null;
      if (s.cached.trainingSkillId !== skillId
          || s.cached.trainingLevel !== level
          || s.cached.trainingFinishDate !== finish) {
        s.cached.trainingSkillId = skillId;
        s.cached.trainingLevel = level;
        s.cached.trainingFinishDate = finish;
        s.cached.trainingSkillName = skillId ? await resolveType(skillId) : null;
        updates.trainingSkillId = skillId;
        updates.trainingLevel = level;
        updates.trainingFinishDate = finish;
        updates.trainingSkillName = s.cached.trainingSkillName;
        changed = true;
      }
    }

    if (now >= s.fleet.nextFetchAt) {
      const fleet = await getCharacterFleet(id);
      s.fleet.nextFetchAt = now + FALLBACK_TTL.fleet * 1000;
      const fid = fleet?.fleet_id ?? null;
      const role = fleet?.role ?? null;
      if (s.cached.fleetId !== fid) {
        s.cached.fleetId = fid;
        updates.fleetId = fid;
        changed = true;
      }
      if (s.cached.fleetRole !== role) {
        s.cached.fleetRole = role;
        updates.fleetRole = role;
        changed = true;
      }
    }

    if (now >= s.sp.nextFetchAt) {
      const { data, expires } = await getSkills(id);
      s.sp.nextFetchAt = expires ?? now + FALLBACK_TTL.sp * 1000;
      if (s.cached.totalSp !== data.total_sp) {
        s.cached.totalSp = data.total_sp;
        updates.totalSp = data.total_sp;
        changed = true;
      }
      const u = data.unallocated_sp ?? 0;
      if (s.cached.unallocatedSp !== u) {
        s.cached.unallocatedSp = u;
        updates.unallocatedSp = u;
        changed = true;
      }
    }

    if (now >= s.implants.nextFetchAt) {
      const { data, expires } = await getImplants(id);
      s.implants.nextFetchAt = expires ?? now + FALLBACK_TTL.implants * 1000;
      const names = await Promise.all(data.map(id => resolveType(id)));
      const same = names.length === s.cached.implantNames.length && names.every((n, i) => n === s.cached.implantNames[i]);
      if (!same) {
        s.cached.implantNames = names;
        updates.implantNames = names;
        changed = true;
      }
    }

    if (now >= s.corp.nextFetchAt) {
      const pub = await getCharacterPublic(id);
      s.corp.nextFetchAt = now + FALLBACK_TTL.corp * 1000;
      if (s.cached.corporationId !== pub.corporation_id) {
        const corp = await resolveCorporation(pub.corporation_id);
        s.cached.corporationId = pub.corporation_id;
        s.cached.corporationName = corp.name;
        s.cached.corporationTicker = corp.ticker;
        updates.corporationId = pub.corporation_id;
        updates.corporationName = corp.name;
        updates.corporationTicker = corp.ticker;
        changed = true;
      }
    }
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 403) {
      // Usually means token was revoked or scope mismatch; tokens.ts flags needs_reauth.
      console.warn(`[poll ${id}] 403 — ${e.message}`);
    } else if (e.status === 420) {
      console.warn(`[poll ${id}] error-limited, backing off`);
      scheduleNext(id, 60_000);
      return;
    } else {
      console.warn(`[poll ${id}] ${e.message}`);
    }
  }

  if (changed) {
    s.cached.updatedAt = Date.now();
    updates.updatedAt = s.cached.updatedAt;
    emit(id, updates);
  }

  const next = Math.min(
    s.location.nextFetchAt,
    s.ship.nextFetchAt,
    s.online.nextFetchAt,
    s.wallet.nextFetchAt,
    s.skills.nextFetchAt,
    s.sp.nextFetchAt,
    s.implants.nextFetchAt,
    s.fleet.nextFetchAt,
    s.corp.nextFetchAt,
  );
  const delay = Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, next - Date.now()));
  scheduleNext(id, delay);
}

function emit(id: number, updates: Partial<CharacterStatus>) {
  bus.emit('status', { characterId: id, ...updates });
}
