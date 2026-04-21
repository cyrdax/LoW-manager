import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import type { CharacterRow } from '../types.ts';
import { forgetCharacter, ensureCharacter, snapshot } from '../polling/scheduler.ts';
import { bus } from '../polling/events.ts';

export function registerCharacterRoutes(app: FastifyInstance) {
  app.get('/api/characters', async () => {
    // Ensure every DB character has polling state (e.g. right after first SSO)
    const rows = db.prepare('SELECT * FROM characters ORDER BY added_at').all() as CharacterRow[];
    for (const r of rows) ensureCharacter(r);
    return snapshot();
  });

  app.delete<{ Params: { id: string } }>('/api/characters/:id', async (req) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM characters WHERE character_id = ?').run(id);
    forgetCharacter(id);
    return { ok: true };
  });

  const bossSchema = z.object({ character_id: z.number() });
  app.post('/api/boss', async (req, reply) => {
    const parsed = bossSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const tx = db.transaction((id: number) => {
      db.prepare('UPDATE characters SET is_boss = 0').run();
      db.prepare('UPDATE characters SET is_boss = 1 WHERE character_id = ?').run(id);
    });
    tx(parsed.data.character_id);

    for (const row of db.prepare('SELECT * FROM characters').all() as CharacterRow[]) {
      ensureCharacter(row);
      bus.emit('status', { characterId: row.character_id, isBoss: row.is_boss === 1 });
    }
    return { ok: true };
  });
}
