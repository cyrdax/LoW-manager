import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import type { CharacterRow } from '../types.ts';
import { setAutopilotWaypoint } from '../esi/ui.ts';
import { snapshotOne } from '../polling/scheduler.ts';

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const body = z.object({
  destination_id: z.number().int(),
  clear_other_waypoints: z.boolean().optional(),
  add_to_beginning: z.boolean().optional(),
  only_online: z.boolean().optional(),
  character_ids: z.array(z.number().int()).optional(),
});

export function registerAutopilotRoutes(app: FastifyInstance) {
  app.post('/api/autopilot/waypoint', async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { destination_id, clear_other_waypoints = true, add_to_beginning = false, only_online = true, character_ids } = parsed.data;
    const selection = character_ids ? new Set(character_ids) : null;

    const all = db.prepare('SELECT * FROM characters WHERE needs_reauth = 0').all() as CharacterRow[];
    const chars = selection ? all.filter(c => selection.has(c.character_id)) : all;
    const results: Array<{ characterId: number; name: string; ok: boolean; error?: string }> = [];

    for (const c of chars) {
      if (only_online && snapshotOne(c.character_id)?.online !== true) {
        results.push({ characterId: c.character_id, name: c.character_name, ok: false, error: 'offline' });
        continue;
      }
      try {
        await setAutopilotWaypoint(c.character_id, { destination_id, clear_other_waypoints, add_to_beginning });
        results.push({ characterId: c.character_id, name: c.character_name, ok: true });
      } catch (err) {
        const e = err as { status?: number; body?: string; message?: string };
        results.push({
          characterId: c.character_id,
          name: c.character_name,
          ok: false,
          error: e.body ?? e.message ?? `HTTP ${e.status ?? '?'}`,
        });
      }
      await sleep(50);
    }

    return { destination_id, results };
  });
}
