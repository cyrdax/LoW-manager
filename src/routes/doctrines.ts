import type { FastifyInstance } from 'fastify';
import {
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
} from '../auth/pilot-access.ts';
import { db } from '../db.ts';
import { createDoctrineStore, type DoctrineDetail, type DoctrineStore } from '../fits/doctrines.ts';
import { createFitStore, type FitStore, type LibraryVisibility, type SavedFitDetail } from '../fits/store.ts';

export interface DoctrineRouteDeps {
  store?: DoctrineStore;
  fitStore?: FitStore;
  currentUser?: CurrentUserResolver;
}

export function registerDoctrineRoutes(app: FastifyInstance, deps: DoctrineRouteDeps = {}) {
  const store = deps.store ?? createDoctrineStore(db);
  const fitStore = deps.fitStore ?? createFitStore(db);
  const currentUser = routeCurrentUser(deps);

  app.get('/api/doctrines', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const query = req.query as { q?: string; visibility?: string };
    const visibility = parseVisibility(query.visibility);
    return store.list(visibility === 'public'
      ? { q: query.q, visibility: 'public' }
      : { q: query.q, visibility: 'private', ownerUserId: user.id });
  });

  app.post('/api/doctrines', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const body = req.body as { name?: string; description?: string; visibility?: string } | undefined;
    if (!body?.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      return store.create({
        name: body.name,
        description: body.description,
        ownerUserId: user.id,
        visibility: parseVisibility(body.visibility),
      });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to create doctrine') });
    }
  });

  app.get('/api/doctrines/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const doctrine = store.get(id);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canViewDoctrine(doctrine, user)) return reply.code(403).send({ error: 'not allowed' });
    return doctrine;
  });

  app.put('/api/doctrines/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
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
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    if (!store.delete(id)) return reply.code(404).send({ error: 'doctrine not found' });
    return { ok: true };
  });

  app.post('/api/doctrines/:id/fits', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    const fitId = cleanPositiveNumber((req.body as { fitId?: number } | undefined)?.fitId);
    if (!fitId) return reply.code(400).send({ error: 'fitId is required' });
    const fit = fitStore.get(fitId);
    if (!fit) return reply.code(404).send({ error: 'saved fit not found' });
    if (!canViewFit(fit, user)) return reply.code(403).send({ error: 'not allowed' });
    if (existing.visibility === 'public' && fit.visibility !== 'public') {
      return reply.code(400).send({ error: 'public doctrines can only include public fits' });
    }
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
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    const fitId = cleanPositiveNumber((req.params as { fitId?: string }).fitId);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    if (!fitId) return reply.code(400).send({ error: 'valid fit id is required' });
    const existing = store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    const doctrine = store.removeFit(id, fitId);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    return doctrine;
  });

  app.post('/api/doctrines/:id/publish', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    try {
      return store.publish(id);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to publish doctrine') });
    }
  });

  app.post('/api/doctrines/:id/copy-private', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canViewDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    return store.copyToPrivate(id, user.id);
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

function parseVisibility(raw: string | undefined): LibraryVisibility {
  return raw === 'public' ? 'public' : 'private';
}

function canViewDoctrine(doctrine: DoctrineDetail, user: { id: string; role: 'user' | 'admin' }): boolean {
  return doctrine.visibility === 'public' || canEditDoctrine(doctrine, user);
}

function canEditDoctrine(doctrine: DoctrineDetail, user: { id: string; role: 'user' | 'admin' }): boolean {
  return user.role === 'admin' || doctrine.ownerUserId === user.id;
}

function canViewFit(fit: SavedFitDetail, user: { id: string; role: 'user' | 'admin' }): boolean {
  return fit.visibility === 'public' || user.role === 'admin' || fit.ownerUserId === user.id;
}
