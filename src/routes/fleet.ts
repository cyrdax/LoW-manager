import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getOwnedCharacter,
  requireOwnedCharacter,
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
  type OwnsCharacter,
} from '../auth/pilot-access.ts';
import { db } from '../db.ts';
import type { CharacterRow, InviteResult } from '../types.ts';
import {
  ensureSquad,
  getCharacterFleet,
  getFleetMembers,
  getFleetWings,
  inviteMember,
  kickMember,
  moveMember,
  NoSquadError,
  type FleetMember,
} from '../esi/fleet.ts';
import { snapshotOne } from '../polling/scheduler.ts';
import { getCharacterPublic, resolveSystem, resolveType } from '../esi/universe.ts';

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const inviteBody = z.object({
  character_ids: z.array(z.number().int()).optional(),
  wing_id: z.number().int().optional(),
  squad_id: z.number().int().optional(),
});

export interface FleetRouteDeps {
  currentUser?: CurrentUserResolver;
  ownsCharacter?: OwnsCharacter;
}

export function registerFleetRoutes(app: FastifyInstance, deps: FleetRouteDeps = {}) {
  const currentUser = routeCurrentUser(deps);
  const owns = deps.ownsCharacter;

  app.post('/api/fleet/invite-all', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const parsed = inviteBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const selection = parsed.data.character_ids ? new Set(parsed.data.character_ids) : null;
    const explicitWing = parsed.data.wing_id;
    const explicitSquad = parsed.data.squad_id;
    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
    if (!boss) return reply.code(400).send({ error: 'No fleet boss selected' });
    if (boss.needs_reauth) return reply.code(400).send({ error: 'Fleet boss needs to re-authenticate' });

    const fleet = await getCharacterFleet(boss.character_id);
    if (!fleet) {
      return reply.code(400).send({
        error: 'Fleet boss is not currently in a fleet. Form a fleet in-client, then try again.',
      });
    }
    if (fleet.role !== 'fleet_commander') {
      return reply.code(400).send({
        error: `${boss.character_name} is ${fleet.role}, not the fleet commander. In the in-client fleet window drag them to the Fleet Commander slot at the top, wait ~30s for ESI to catch up, then try again.`,
      });
    }

    let target: { wingId: number; squadId: number };
    if (explicitWing != null && explicitSquad != null) {
      target = { wingId: explicitWing, squadId: explicitSquad };
    } else {
      try {
        target = await ensureSquad(fleet.fleet_id, boss.character_id);
      } catch (err) {
        if (err instanceof NoSquadError) {
          return reply.code(409).send({ error: err.message });
        }
        const e = err as { status?: number; body?: string; message?: string };
        return reply.code(502).send({ error: `Could not resolve a squad: ${describeError(e)}` });
      }
    }

    const allAlts = db.prepare('SELECT * FROM characters WHERE user_id = ? AND is_boss = 0 AND needs_reauth = 0').all(user.id) as CharacterRow[];
    const alts = selection ? allAlts.filter(a => selection.has(a.character_id)) : allAlts;
    const results: InviteResult[] = [];

    app.log.info({ fleet_id: fleet.fleet_id, role: fleet.role, target, bossId: boss.character_id }, 'invite-all starting');

    for (const alt of alts) {
      // Skip alts already in the boss's fleet (per last poll). If stale, ESI will 422 and
      // we report that gracefully below.
      const altCached = snapshotOne(alt.character_id);
      if (altCached?.fleetId === fleet.fleet_id) {
        results.push({ characterId: alt.character_id, name: alt.character_name, ok: true, error: 'already in fleet' });
        continue;
      }

      const payload = {
        character_id: alt.character_id,
        role: 'squad_member' as const,
        wing_id: target.wingId,
        squad_id: target.squadId,
      };
      try {
        await inviteMember(fleet.fleet_id, boss.character_id, payload);
        results.push({ characterId: alt.character_id, name: alt.character_name, ok: true });
      } catch (err) {
        const e = err as { status?: number; body?: string; message?: string };
        app.log.warn({ alt: alt.character_name, status: e.status, body: e.body, payload }, 'invite failed');
        results.push({
          characterId: alt.character_id,
          name: alt.character_name,
          ok: false,
          error: describeError(e),
        });
      }
      await sleep(120);
    }

    return { fleet_id: fleet.fleet_id, role: fleet.role, target, results };
  });

  const moveSchema = z.object({
    character_ids: z.array(z.number().int()).min(1),
    wing_id: z.number().int(),
    squad_id: z.number().int(),
    actor_character_id: z.number().int().optional(),
    role: z.enum(['squad_member', 'squad_commander', 'wing_commander']).optional(),
  });

  // ESI's PUT /fleets/{id}/members/{member_id}/ requires command authority on the
  // *calling* token — it doesn't honor in-client free-move. So we use the boss's
  // fleet_commander token to move any selected pilot. If the boss isn't FC, fail
  // fast with a clear message.
  app.post('/api/fleet/move', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    // Actor (whose token to call ESI with): explicit override → falls back to boss flag.
    let actor: CharacterRow | undefined;
    if (parsed.data.actor_character_id != null) {
      actor = getOwnedCharacter(user.id, parsed.data.actor_character_id);
      if (!actor) return reply.code(400).send({ error: 'actor_character_id is not an authed character' });
    } else {
      actor = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
      if (!actor) return reply.code(400).send({ error: 'No fleet boss selected' });
    }
    if (actor.needs_reauth) return reply.code(400).send({ error: `${actor.character_name} needs to re-authenticate` });

    const fleet = await getCharacterFleet(actor.character_id);
    if (!fleet) return reply.code(400).send({ error: `${actor.character_name} is not currently in a fleet.` });
    if (fleet.role !== 'fleet_commander') {
      return reply.code(400).send({
        error: `${actor.character_name} is ${fleet.role}, not the fleet commander. Moving via ESI requires the actor to be in the fleet_commander slot.`,
      });
    }

    const results: InviteResult[] = [];
    for (const id of parsed.data.character_ids) {
      const charRow = getOwnedCharacter(user.id, id);
      const name = charRow?.character_name ?? `#${id}`;
      if (!charRow) {
        results.push({ characterId: id, name, ok: false, error: 'character_not_owned' });
        continue;
      }
      try {
        await moveMember(fleet.fleet_id, actor.character_id, id, {
          role: parsed.data.role ?? 'squad_member',
          wing_id: parsed.data.wing_id,
          squad_id: parsed.data.squad_id,
        });
        results.push({ characterId: id, name, ok: true });
      } catch (err) {
        const e = err as { status?: number; body?: string; message?: string };
        app.log.warn({ alt: name, status: e.status, body: e.body }, 'move failed');
        results.push({ characterId: id, name, ok: false, error: describeError(e) });
      }
      await sleep(80);
    }

    return { fleet_id: fleet.fleet_id, target: { wing_id: parsed.data.wing_id, squad_id: parsed.data.squad_id }, results };
  });

  // Full fleet roster (FC-only). Resolves character/ship/system names so the UI
  // can render without N+1 lookups. Uses the actor's token (override or boss).
  app.get<{ Querystring: { actor?: string } }>('/api/fleet/roster', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    let actor: CharacterRow | undefined;
    const actorOverride = Number(req.query.actor);
    if (Number.isFinite(actorOverride) && actorOverride > 0) {
      actor = getOwnedCharacter(user.id, actorOverride);
      if (!actor) return reply.code(400).send({ error: 'actor is not an authed character' });
    } else {
      actor = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
      if (!actor) return reply.code(400).send({ error: 'No actor selected (pick a pilot)' });
    }
    if (actor.needs_reauth) return reply.code(400).send({ error: `${actor.character_name} needs to re-authenticate` });

    const fleet = await getCharacterFleet(actor.character_id);
    if (!fleet) return { actor: pubActor(actor), fleet: null, wings: [], members: [] };

    // Wings + roster require fleet_commander role on the calling token.
    if (fleet.role !== 'fleet_commander') {
      return reply.code(403).send({
        actor: pubActor(actor),
        fleet,
        error: `${actor.character_name} is ${fleet.role}, not the fleet commander. ESI gates roster reads on FC role.`,
      });
    }

    let wings: Awaited<ReturnType<typeof getFleetWings>>;
    let raw: FleetMember[];
    try {
      [wings, raw] = await Promise.all([
        getFleetWings(fleet.fleet_id, actor.character_id),
        getFleetMembers(fleet.fleet_id, actor.character_id),
      ]);
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      return reply.code(e.status ?? 500).send({ actor: pubActor(actor), fleet, error: describeError(e) });
    }

    // Deduplicate name resolutions.
    const charIds = Array.from(new Set(raw.map(m => m.character_id)));
    const typeIds = Array.from(new Set(raw.map(m => m.ship_type_id)));
    const sysIds = Array.from(new Set(raw.map(m => m.solar_system_id)));

    const charNames = new Map<number, string>();
    await Promise.all(charIds.map(async id => {
      try {
        const p = await getCharacterPublic(id);
        charNames.set(id, p.name);
      } catch {
        charNames.set(id, `Character ${id}`);
      }
    }));

    const typeNames = new Map<number, string>();
    await Promise.all(typeIds.map(async id => {
      try { typeNames.set(id, await resolveType(id)); }
      catch { typeNames.set(id, `Type ${id}`); }
    }));

    const sysNames = new Map<number, string>();
    await Promise.all(sysIds.map(async id => {
      try { sysNames.set(id, await resolveSystem(id)); }
      catch { sysNames.set(id, `#${id}`); }
    }));

    const members = raw.map(m => ({
      characterId: m.character_id,
      characterName: charNames.get(m.character_id) ?? `Character ${m.character_id}`,
      shipTypeId: m.ship_type_id,
      shipTypeName: typeNames.get(m.ship_type_id) ?? `Type ${m.ship_type_id}`,
      solarSystemId: m.solar_system_id,
      solarSystemName: sysNames.get(m.solar_system_id) ?? `#${m.solar_system_id}`,
      stationId: m.station_id ?? null,
      takesFleetWarp: m.takes_fleet_warp,
      role: m.role,
      roleName: m.role_name,
      wingId: m.wing_id,
      squadId: m.squad_id,
      joinTime: m.join_time,
    }));

    return {
      actor: pubActor(actor),
      fleet,
      wings,
      members,
    };
  });

  const kickSchema = z.object({
    character_id: z.number().int(),
    actor_character_id: z.number().int().optional(),
  });
  app.post('/api/fleet/kick', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const parsed = kickSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    let actor: CharacterRow | undefined;
    if (parsed.data.actor_character_id != null) {
      actor = getOwnedCharacter(user.id, parsed.data.actor_character_id);
    } else {
      actor = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
    }
    if (!actor) return reply.code(400).send({ error: 'no actor' });
    const fleet = await getCharacterFleet(actor.character_id);
    if (!fleet) return reply.code(400).send({ error: 'actor not in fleet' });
    if (fleet.role !== 'fleet_commander') return reply.code(400).send({ error: 'actor must be fleet_commander' });
    try {
      await kickMember(fleet.fleet_id, actor.character_id, parsed.data.character_id);
      return { ok: true };
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      return reply.code(e.status ?? 500).send({ error: describeError(e) });
    }
  });

  // Fleet structure for the invite-target picker: wings, squads, and the boss's own role.
  app.get('/api/fleet/structure', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
    if (!boss) return reply.code(400).send({ error: 'No fleet boss selected' });
    const fleet = await getCharacterFleet(boss.character_id);
    if (!fleet) return { fleet: null, wings: [] };
    if (fleet.role !== 'fleet_commander') return { fleet, wings: [], error: 'boss is not fleet_commander' };
    try {
      const wings = await getFleetWings(fleet.fleet_id, boss.character_id);
      return { fleet, wings };
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      return { fleet, wings: [], error: describeError(e) };
    }
  });

  // Diagnostic: try reading a fleet's wings via the specified character's token.
  // Answers: "does a non-FC member's token see fleet structure via ESI?"
  app.get<{ Params: { id: string } }>('/api/fleet/wings-via/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
    if (!requireOwnedCharacter(user.id, id, reply, owns)) return reply;
    const charFleet = await getCharacterFleet(id);
    if (!charFleet) return { character_id: id, fleet: null, wings: null, error: 'character not in a fleet' };
    try {
      const wings = await getFleetWings(charFleet.fleet_id, id);
      return { character_id: id, fleet: charFleet, wings };
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      return { character_id: id, fleet: charFleet, wings: null, status: e.status, body: e.body };
    }
  });

  // Diagnostic: try inviting exactly one alt with current state and show the raw ESI response.
  app.get<{ Querystring: { alt?: string } }>('/api/fleet/test-invite', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const altId = Number(req.query.alt);
    if (!Number.isFinite(altId)) return reply.code(400).send({ error: 'pass ?alt=<character_id>' });
    if (!requireOwnedCharacter(user.id, altId, reply, owns)) return reply;
    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
    if (!boss) return reply.code(400).send({ error: 'no boss' });
    const fleet = await getCharacterFleet(boss.character_id);
    if (!fleet) return { boss: boss.character_name, error: 'boss not in fleet' };
    const payload = {
      character_id: altId,
      role: 'squad_member' as const,
      wing_id: fleet.wing_id,
      squad_id: fleet.squad_id,
    };
    try {
      await inviteMember(fleet.fleet_id, boss.character_id, payload);
      return { ok: true, boss: boss.character_name, fleet, payload };
    } catch (err) {
      const e = err as { status?: number; body?: string; message?: string };
      return { ok: false, boss: boss.character_name, fleet, payload, status: e.status, body: e.body, message: e.message };
    }
  });

  // Diagnostic: dump what the boss's token can see on the fleet.
  app.get('/api/fleet/debug', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1 AND user_id = ?').get(user.id) as CharacterRow | undefined;
    if (!boss) return reply.code(400).send({ error: 'No boss selected' });
    const fleet = await getCharacterFleet(boss.character_id);
    if (!fleet) return { boss: boss.character_name, fleet: null };
    let wings: unknown = 'NOT ATTEMPTED';
    try {
      const { getFleetWings } = await import('../esi/fleet.ts');
      wings = await getFleetWings(fleet.fleet_id, boss.character_id);
    } catch (err) {
      const e = err as { status?: number; body?: string };
      wings = { error: e.status, body: e.body };
    }
    return { boss: boss.character_name, fleet, wings };
  });
}

function pubActor(row: CharacterRow): { characterId: number; name: string } {
  return { characterId: row.character_id, name: row.character_name };
}

function describeError(e: { status?: number; body?: string; message?: string }): string {
  // For 404 (and anything unknown), pass through the actual ESI body so we can see what it said.
  if (e.status === 422) return `Already in a fleet: ${e.body ?? ''}`;
  if (e.status === 403) return `Forbidden: ${e.body ?? ''}`;
  if (e.status === 404) return `Not found (${e.body ?? 'no body'})`;
  return `HTTP ${e.status ?? '?'}: ${e.body ?? e.message ?? 'Unknown error'}`;
}
