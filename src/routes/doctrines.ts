import type { FastifyInstance } from 'fastify';
import {
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
} from '../auth/pilot-access.ts';
import { type AsyncDoctrineStore, type DoctrineDetail, type DoctrineStore } from '../fits/doctrines.ts';
import {
  extractGoogleDocTabs,
  googleDocApiUrl,
  googleDocTextExportUrl,
  syncDoctrineFitsFromTabs,
  syncDoctrineFitsFromText,
  type GoogleDocTabText,
} from '../fits/google-doc-sync.ts';
import { type AsyncFitStore, type FitStore, type LibraryVisibility, type SavedFitDetail } from '../fits/store.ts';

const MAX_GOOGLE_DOC_TEXT_CHARS = 512 * 1024;

export interface DoctrineRouteDeps {
  store?: DoctrineStore | AsyncDoctrineStore;
  fitStore?: FitStore | AsyncFitStore;
  currentUser?: CurrentUserResolver;
  fetchGoogleDocText?: (exportUrl: string) => Promise<string>;
  fetchGoogleDocTabs?: (apiUrl: string) => Promise<GoogleDocTabText[]>;
}

export function registerDoctrineRoutes(app: FastifyInstance, deps: DoctrineRouteDeps = {}) {
  const store = deps.store ?? missingDoctrineStore();
  const fitStore = deps.fitStore ?? missingFitStore();
  const currentUser = routeCurrentUser(deps);
  const fetchGoogleDocText = deps.fetchGoogleDocText ?? defaultFetchGoogleDocText;
  const fetchGoogleDocTabs = deps.fetchGoogleDocTabs ?? defaultFetchGoogleDocTabs;

  app.get('/api/doctrines', async (req, reply) => {
    const query = req.query as { q?: string; visibility?: string; fitId?: string };
    const visibility = parseVisibility(query.visibility);
    const fitId = query.fitId == null ? undefined : cleanPositiveNumber(query.fitId);
    if (query.fitId != null && !fitId) return reply.code(400).send({ error: 'valid fit id is required' });
    if (visibility === 'public') return await store.list({ q: query.q, visibility: 'public', fitId });
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    return await store.list({ q: query.q, visibility: 'private', ownerUserId: user.id, fitId });
  });

  app.post('/api/doctrines', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const body = req.body as { name?: string; description?: string; googleDocUrl?: string; visibility?: string } | undefined;
    if (!body?.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      return await store.create({
        name: body.name,
        description: body.description,
        googleDocUrl: body.googleDocUrl,
        ownerUserId: user.id,
        visibility: parseVisibility(body.visibility),
      });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to create doctrine') });
    }
  });

  app.get('/api/doctrines/:id', async (req, reply) => {
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const doctrine = await store.get(id);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    if (doctrine.visibility === 'public') return doctrine;
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    if (!canViewDoctrine(doctrine, user)) return reply.code(403).send({ error: 'not allowed' });
    return doctrine;
  });

  app.put('/api/doctrines/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    const body = req.body as { name?: string; description?: string; googleDocUrl?: string } | undefined;
    if (body?.name != null && !body.name.trim()) return reply.code(400).send({ error: 'name is required' });
    try {
      const doctrine = await store.update(id, { name: body?.name, description: body?.description, googleDocUrl: body?.googleDocUrl });
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
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    if (!(await store.delete(id))) return reply.code(404).send({ error: 'doctrine not found' });
    return { ok: true };
  });

  app.post('/api/doctrines/:id/fits', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    const body = req.body as { fitId?: number; tabId?: string; tabTitle?: string; tabSortOrder?: number } | undefined;
    const fitId = cleanPositiveNumber(body?.fitId);
    if (!fitId) return reply.code(400).send({ error: 'fitId is required' });
    const fit = await fitStore.get(fitId);
    if (!fit) return reply.code(404).send({ error: 'saved fit not found' });
    if (!canViewFit(fit, user)) return reply.code(403).send({ error: 'not allowed' });
    if (existing.visibility === 'public' && fit.visibility !== 'public') {
      return reply.code(400).send({ error: 'public doctrines can only include public fits' });
    }
    try {
      const doctrine = await store.addFit(id, fitId, { id: body?.tabId, title: body?.tabTitle, sortOrder: body?.tabSortOrder });
      if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
      return doctrine;
    } catch (err) {
      if (errorMessage(err, '').includes('Saved fit not found')) return reply.code(404).send({ error: 'saved fit not found' });
      return reply.code(400).send({ error: errorMessage(err, 'failed to add fit') });
    }
  });

  app.delete<{ Querystring: { tabId?: string } }>('/api/doctrines/:id/fits/:fitId', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    const fitId = cleanPositiveNumber((req.params as { fitId?: string }).fitId);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    if (!fitId) return reply.code(400).send({ error: 'valid fit id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    const doctrine = await store.removeFit(id, fitId, req.query.tabId);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    return doctrine;
  });

  app.post('/api/doctrines/:id/refresh-fits', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const doctrine = await store.get(id);
    if (!doctrine) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(doctrine, user)) return reply.code(403).send({ error: 'not allowed' });
    if (!doctrine.googleDocUrl.trim()) return reply.code(400).send({ error: 'doctrine has no google doc url' });
    const apiUrl = googleDocApiUrl(doctrine.googleDocUrl, process.env.GOOGLE_DOCS_API_KEY ?? process.env.GOOGLE_API_KEY);
    const exportUrl = googleDocTextExportUrl(doctrine.googleDocUrl);
    if (!apiUrl && !exportUrl) return reply.code(400).send({ error: 'unsupported google doc url' });

    try {
      let result;
      try {
        const tabs = apiUrl ? await fetchGoogleDocTabs(apiUrl) : [];
        result = await syncDoctrineFitsFromTabs({
          doctrine,
          fitStore,
          doctrineStore: store,
          tabs,
          ownerUserId: user.id,
        });
      } catch (tabErr) {
        if (!exportUrl) throw tabErr;
        const rawText = await fetchGoogleDocText(exportUrl);
        result = await syncDoctrineFitsFromText({
          doctrine,
          fitStore,
          doctrineStore: store,
          rawText,
          ownerUserId: user.id,
        });
      }
      if (
        result.updated.length === 0
        && result.created.length === 0
        && result.ambiguous.length === 0
        && result.failed.length === 0
      ) {
        return reply.code(400).send({ error: result.skipped[0]?.reason ?? 'No EFT fit blocks found.' });
      }
      return result;
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to refresh doctrine fits') });
    }
  });

  app.post('/api/doctrines/:id/publish', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canEditDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    try {
      return await store.publish(id);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to publish doctrine') });
    }
  });

  app.post('/api/doctrines/:id/copy-private', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid doctrine id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'doctrine not found' });
    if (!canViewDoctrine(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    return await store.copyToPrivate(id, user.id);
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

async function defaultFetchGoogleDocText(exportUrl: string): Promise<string> {
  const res = await fetch(exportUrl);
  if (!res.ok) throw new Error(`Google Doc fetch failed with ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_GOOGLE_DOC_TEXT_CHARS) throw new Error('Google Doc export is too large.');
  return text;
}

async function defaultFetchGoogleDocTabs(apiUrl: string): Promise<GoogleDocTabText[]> {
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Google Docs API fetch failed with ${res.status}`);
  const json = await res.json();
  const tabs = extractGoogleDocTabs(json);
  const totalText = tabs.reduce((sum, tab) => sum + tab.text.length, 0);
  if (totalText > MAX_GOOGLE_DOC_TEXT_CHARS) throw new Error('Google Doc tab export is too large.');
  return tabs;
}

function missingDoctrineStore(): never {
  throw new Error('registerDoctrineRoutes requires a doctrine store');
}

function missingFitStore(): never {
  throw new Error('registerDoctrineRoutes requires a fit store');
}
