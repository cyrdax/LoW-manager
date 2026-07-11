import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { forgetCharacter, ensureCharacter, snapshot } from '../polling/scheduler.ts';
import { bus } from '../polling/events.ts';
import { createCurrentUserResolver, type CurrentUserResolver } from '../auth/current-user.ts';
import { createUserStore, type UserStore } from '../auth/user-store.ts';
import { createSqliteCharacterStore, type CharacterStore } from '../characters/store.ts';

export interface CharacterRouteDeps {
  currentUser?: CurrentUserResolver;
  users?: Pick<UserStore, 'setMainCharacter'>;
  characters?: CharacterStore;
}

export function registerCharacterRoutes(app: FastifyInstance, deps: CharacterRouteDeps = {}) {
  const currentUser = deps.currentUser ?? createCurrentUserResolver();
  const users = deps.users ?? createUserStore();
  const characterStore = deps.characters ?? createSqliteCharacterStore();

  app.get('/api/characters', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    // Ensure every DB character has polling state (e.g. right after first SSO)
    const rows = characterStore.listByUser(user.id);
    for (const r of rows) ensureCharacter(r);
    const ids = new Set(rows.map(r => r.character_id));
    return snapshot().filter(c => ids.has(c.characterId));
  });

  app.delete<{ Params: { id: string } }>('/api/characters/:id', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const id = Number(req.params.id);
    if (characterStore.deleteOwned(user.id, id)) {
      if (user.mainCharacterId === id) await users.setMainCharacter(user.id, null);
      forgetCharacter(id);
    }
    return { ok: true };
  });

  const mainCharacterSchema = z.object({ character_id: z.number().int().positive().nullable() });
  app.put('/api/characters/main', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const parsed = mainCharacterSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const characterId = parsed.data.character_id;
    if (characterId != null && !characterStore.owns(user.id, characterId)) {
      return reply.code(404).send({ error: 'character_not_found' });
    }

    const updated = await users.setMainCharacter(user.id, characterId);
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    return { mainCharacterId: updated.mainCharacterId };
  });

  const bossSchema = z.object({ character_id: z.number() });
  app.post('/api/boss', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    const parsed = bossSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    for (const row of characterStore.setBoss(user.id, parsed.data.character_id)) {
      ensureCharacter(row);
      bus.emit('status', { characterId: row.character_id, isBoss: row.is_boss === 1 });
    }
    return { ok: true };
  });
}
