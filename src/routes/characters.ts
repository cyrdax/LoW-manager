import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import type { CharacterRow } from '../types.ts';
import { forgetCharacter, ensureCharacter, snapshot } from '../polling/scheduler.ts';
import { bus } from '../polling/events.ts';
import { createCurrentUserResolver, type CurrentUserResolver } from '../auth/current-user.ts';

export interface CharacterRouteDeps {
  currentUser?: CurrentUserResolver;
}

export function registerCharacterRoutes(app: FastifyInstance, deps: CharacterRouteDeps = {}) {
  const currentUser = deps.currentUser ?? createCurrentUserResolver();

  app.get('/api/characters', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    // Ensure every DB character has polling state (e.g. right after first SSO)
    const rows = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY added_at').all(user.id) as CharacterRow[];
    for (const r of rows) ensureCharacter(r);
    const ids = new Set(rows.map(r => r.character_id));
    return snapshot().filter(c => ids.has(c.characterId));
  });

  app.delete<{ Params: { id: string } }>('/api/characters/:id', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM characters WHERE character_id = ? AND user_id = ?').run(id, user.id);
    if (result.changes > 0) forgetCharacter(id);
    return { ok: true };
  });

  const bossSchema = z.object({ character_id: z.number() });
  app.post('/api/boss', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const parsed = bossSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const tx = db.transaction((id: number, userId: string) => {
      db.prepare('UPDATE characters SET is_boss = 0 WHERE user_id = ?').run(userId);
      db.prepare('UPDATE characters SET is_boss = 1 WHERE character_id = ? AND user_id = ?').run(id, userId);
    });
    tx(parsed.data.character_id, user.id);

    for (const row of db.prepare('SELECT * FROM characters WHERE user_id = ?').all(user.id) as CharacterRow[]) {
      ensureCharacter(row);
      bus.emit('status', { characterId: row.character_id, isBoss: row.is_boss === 1 });
    }
    return { ok: true };
  });
}
