import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import type { CharacterRow, InviteResult } from '../types.ts';
import { ensureSquad, getCharacterFleet, getFleetWings, inviteMember, moveMember, NoSquadError } from '../esi/fleet.ts';
import { snapshotOne } from '../polling/scheduler.ts';

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const inviteBody = z.object({
  character_ids: z.array(z.number().int()).optional(),
  wing_id: z.number().int().optional(),
  squad_id: z.number().int().optional(),
});

export function registerFleetRoutes(app: FastifyInstance) {
  app.post('/api/fleet/invite-all', async (req, reply) => {
    const parsed = inviteBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const selection = parsed.data.character_ids ? new Set(parsed.data.character_ids) : null;
    const explicitWing = parsed.data.wing_id;
    const explicitSquad = parsed.data.squad_id;
    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1').get() as CharacterRow | undefined;
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

    const allAlts = db.prepare('SELECT * FROM characters WHERE is_boss = 0 AND needs_reauth = 0').all() as CharacterRow[];
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
  });

  // Each pilot self-moves using their own write_fleet-scoped token. This mirrors
  // the in-client free-move rule: any fleet member can reseat themselves, no boss
  // involvement needed. Boss role is irrelevant here — the caller is always the
  // pilot being moved.
  app.post('/api/fleet/move', async (req, reply) => {
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const results: InviteResult[] = [];
    for (const id of parsed.data.character_ids) {
      const charRow = db.prepare('SELECT * FROM characters WHERE character_id = ?').get(id) as CharacterRow | undefined;
      if (!charRow) {
        results.push({ characterId: id, name: `#${id}`, ok: false, error: 'character not authed' });
        continue;
      }
      const name = charRow.character_name;
      if (charRow.needs_reauth) {
        results.push({ characterId: id, name, ok: false, error: 'needs reauth' });
        continue;
      }
      try {
        const memberFleet = await getCharacterFleet(id);
        if (!memberFleet) {
          results.push({ characterId: id, name, ok: false, error: 'not currently in a fleet' });
          continue;
        }
        await moveMember(memberFleet.fleet_id, id, id, {
          role: 'squad_member',
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

    return { target: { wing_id: parsed.data.wing_id, squad_id: parsed.data.squad_id }, results };
  });

  // Fleet structure for the invite-target picker: wings, squads, and the boss's own role.
  app.get('/api/fleet/structure', async (_req, reply) => {
    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1').get() as CharacterRow | undefined;
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
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' });
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
    const altId = Number(req.query.alt);
    if (!Number.isFinite(altId)) return reply.code(400).send({ error: 'pass ?alt=<character_id>' });
    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1').get() as CharacterRow | undefined;
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
  app.get('/api/fleet/debug', async (_req, reply) => {
    const boss = db.prepare('SELECT * FROM characters WHERE is_boss = 1').get() as CharacterRow | undefined;
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

function describeError(e: { status?: number; body?: string; message?: string }): string {
  // For 404 (and anything unknown), pass through the actual ESI body so we can see what it said.
  if (e.status === 422) return `Already in a fleet: ${e.body ?? ''}`;
  if (e.status === 403) return `Forbidden: ${e.body ?? ''}`;
  if (e.status === 404) return `Not found (${e.body ?? 'no body'})`;
  return `HTTP ${e.status ?? '?'}: ${e.body ?? e.message ?? 'Unknown error'}`;
}
