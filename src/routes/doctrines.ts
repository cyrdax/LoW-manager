import type { FastifyInstance } from 'fastify';
import { db } from '../db.ts';
import { createDoctrineStore, type DoctrineStore } from '../fits/doctrines.ts';

export interface DoctrineRouteDeps {
  store?: DoctrineStore;
}

export function registerDoctrineRoutes(app: FastifyInstance, deps: DoctrineRouteDeps = {}) {
  const store = deps.store ?? createDoctrineStore(db);

  app.get('/api/doctrines', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '');
    return store.list(q);
  });

  app.post('/api/doctrines', async (req, reply) => {
    const body = req.body as { name?: string; description?: string } | undefined;
    if (!body?.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      return store.create({ name: body.name, description: body.description });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to create doctrine') });
    }
  });

  app.get('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const doctrine = store.get(id);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    return doctrine;
  });

  app.put('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const body = req.body as { name?: string; description?: string } | undefined;
    if (body?.name != null && !body.name.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      const doctrine = store.update(id, { name: body?.name, description: body?.description });
      if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
      return doctrine;
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to update doctrine') });
    }
  });

  app.delete('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    if (!store.delete(id)) return reply.code(404).send({ error: 'doctrine not found' });
    return { ok: true };
  });

  app.post('/api/doctrines/:id/fits', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const fitId = cleanPositiveNumber((req.body as { fitId?: number } | undefined)?.fitId);
    if (!fitId) return reply.code(400).send({ error: 'fitId is required' });
    try {
      const doctrine = store.addFit(id, fitId);
      if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
      return doctrine;
    } catch (err) {
      if (errorMessage(err, '').includes('Saved fit not found')) return reply.code(404).send({ error: 'saved fit not found' });
      return reply.code(400).send({ error: errorMessage(err, 'failed to add fit') });
    }
  });

  app.delete('/api/doctrines/:id/fits/:fitId', async (req, reply) => {
    const id = parseId(req.params);
    const fitId = cleanPositiveNumber((req.params as { fitId?: string }).fitId);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    if (!fitId) return reply.code(400).send({ error: 'valid fit id is required' });
    const doctrine = store.removeFit(id, fitId);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    return doctrine;
  });
}

function parseId(params: unknown): number | null {
  return cleanPositiveNumber((params as { id?: string })?.id) ?? null;
}

function cleanPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
