import type { FastifyInstance } from 'fastify';
import { createCurrentUserResolver, type CurrentUserResolver } from '../auth/current-user.ts';
import { db } from '../db.ts';
import { bus } from '../polling/events.ts';
import { snapshot } from '../polling/scheduler.ts';

export interface StreamRouteDeps {
  currentUser?: CurrentUserResolver;
}

export function registerStreamRoute(app: FastifyInstance, deps: StreamRouteDeps = {}) {
  const currentUser = deps.currentUser ?? createCurrentUserResolver();

  app.get('/api/stream', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'authentication_required' });

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const characterIds = () => new Set(
      (db.prepare('SELECT character_id FROM characters WHERE user_id = ?').all(user.id) as Array<{ character_id: number }>)
        .map(row => row.character_id),
    );
    const ownsCharacter = (value: unknown) => {
      if (typeof value !== 'object' || value === null || !('characterId' in value)) return false;
      return characterIds().has(Number((value as { characterId: unknown }).characterId));
    };

    const ids = characterIds();
    send('snapshot', snapshot().filter(c => ids.has(c.characterId)));

    const onStatus = (update: unknown) => { if (ownsCharacter(update)) send('status', update); };
    const onRemoved = (update: unknown) => { if (ownsCharacter(update)) send('removed', update); };
    bus.on('status', onStatus);
    bus.on('removed', onRemoved);

    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 20_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      bus.off('status', onStatus);
      bus.off('removed', onRemoved);
    });

    return reply;
  });
}
