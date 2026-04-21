import type { FastifyInstance } from 'fastify';
import { bus } from '../polling/events.ts';
import { snapshot } from '../polling/scheduler.ts';

export function registerStreamRoute(app: FastifyInstance) {
  app.get('/api/stream', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send('snapshot', snapshot());

    const onStatus = (update: unknown) => send('status', update);
    const onRemoved = (update: unknown) => send('removed', update);
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
