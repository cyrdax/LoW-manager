import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  requireOwnedCharacter,
  requireUser,
  routeCurrentUser,
  type CurrentUserResolver,
  type OwnsCharacter,
} from '../auth/pilot-access.ts';
import { buildFitDraft } from '../fits/assignment.ts';
import { buildEsiFittingPayload, createCharacterFitting, type EsiFittingCreatePayload } from '../fits/esi.ts';
import { quoteFit, type FitQuote } from '../fits/pricing.ts';
import {
  createDefaultPyfaScreenshotExtractor,
  PYFA_IMAGE_IMPORT_NOT_CONFIGURED,
  renderPyfaExtractionToEft,
  validatePyfaImageInput,
  type PyfaScreenshotExtractor,
} from '../fits/pyfa-image-import.ts';
import { type AsyncFitStore, type FitStore, type LibraryVisibility, type SavedFitDetail } from '../fits/store.ts';
import type { FitDraft } from '../fits/types.ts';
import { searchFitShips } from '../fits/metadata.ts';
import { HUBS, type HubKey } from '../market/pricing.ts';

const MAX_RAW_EFT_CHARS = 64 * 1024;
const MAX_RAW_EFT_LINES = 500;
const RAW_EFT_TOO_LARGE =
  `Fit import is too large. Paste one EFT fit under 64 KB and ${MAX_RAW_EFT_LINES} lines.`;

export interface FitRouteDeps {
  store?: FitStore | AsyncFitStore;
  buildDraft?: typeof buildFitDraft;
  quoteFit?: (fit: FitDraft, hub: HubKey) => Promise<FitQuote>;
  createFitting?: (characterId: number, payload: EsiFittingCreatePayload) => Promise<number | null>;
  searchShips?: typeof searchFitShips;
  currentUser?: CurrentUserResolver;
  ownsCharacter?: OwnsCharacter;
  pyfaScreenshotExtractor?: PyfaScreenshotExtractor;
}

export function registerFitRoutes(app: FastifyInstance, deps: FitRouteDeps = {}) {
  const store = deps.store ?? missingFitStore();
  const draftBuilder = deps.buildDraft ?? buildFitDraft;
  const quote = deps.quoteFit ?? quoteFit;
  const createFitting = deps.createFitting ?? createCharacterFitting;
  const shipSearch = deps.searchShips ?? searchFitShips;
  const currentUser = routeCurrentUser(deps);
  const owns = deps.ownsCharacter;
  const pyfaScreenshotExtractor = deps.pyfaScreenshotExtractor ?? createDefaultPyfaScreenshotExtractor();

  app.get('/api/fits/ships', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '');
    return shipSearch(q, 20).map(ship => ({ id: ship.typeId, name: ship.name, groupName: ship.groupName }));
  });

  app.post('/api/fits/import-pyfa-image', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    try {
      const input = validatePyfaImageInput(req.body);
      const extraction = await pyfaScreenshotExtractor.extract({ ...input, userId: user.id });
      return renderPyfaExtractionToEft(extraction);
    } catch (err) {
      const message = errorMessage(err, 'Failed to import pyfa screenshot.');
      return reply.code(pyfaImportErrorStatus(message)).send({ error: message });
    }
  });

  app.post('/api/fits/preview', async (req, reply) => {
    const body = req.body as { rawEft?: string; shipTypeId?: number } | undefined;
    const rawEft = body?.rawEft;
    const rawError = validateRawEft(rawEft);
    if (rawError) return reply.code(400).send({ error: rawError });
    try {
      return draftBuilder(rawEft!, cleanPositiveNumber(body?.shipTypeId));
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to preview fit') });
    }
  });

  app.post('/api/fits/quote-draft', async (req, reply) => {
    const body = req.body as { rawEft?: string; shipTypeId?: number; hub?: string } | undefined;
    const hub = parseHub(body?.hub);
    if (!hub) return reply.code(400).send({ error: 'hub must be "jita" or "amarr"' });
    const rawEft = body?.rawEft;
    const rawError = validateRawEft(rawEft);
    if (rawError) return reply.code(400).send({ error: rawError });
    try {
      return quote(draftBuilder(rawEft!, cleanPositiveNumber(body?.shipTypeId)), hub);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to quote draft') });
    }
  });

  app.post('/api/fits/send-draft', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const body = req.body as {
      rawEft?: string;
      shipTypeId?: number;
      fitName?: string;
      notes?: string;
      characterId?: number;
    } | undefined;
    const rawEft = body?.rawEft;
    const rawError = validateRawEft(rawEft);
    if (rawError) return reply.code(400).send({ error: rawError });
    const characterId = cleanPositiveNumber(body?.characterId);
    if (!characterId) return reply.code(400).send({ error: 'characterId is required' });
    if (!(await requireOwnedCharacter(user.id, characterId, reply, owns))) return reply;
    try {
      const draft = draftBuilder(rawEft!, cleanPositiveNumber(body?.shipTypeId));
      return sendFit(reply, applyDraftOverrides(draft, { fitName: body?.fitName, notes: body?.notes }), characterId, createFitting);
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to send draft') });
    }
  });

  app.get('/api/fits', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const visibility = parseVisibility((req.query as { visibility?: string }).visibility);
    return visibility === 'public'
      ? await store.list({ visibility: 'public' })
      : await store.list({ visibility: 'private', ownerUserId: user.id });
  });

  app.post('/api/fits', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const body = req.body as { rawEft?: string; shipTypeId?: number; fitName?: string; notes?: string; visibility?: string } | undefined;
    const rawEft = body?.rawEft;
    const rawError = validateRawEft(rawEft);
    if (rawError) return reply.code(400).send({ error: rawError });
    try {
      return await store.create({
        rawEft: rawEft!,
        shipTypeId: cleanPositiveNumber(body?.shipTypeId),
        fitName: body?.fitName,
        notes: body?.notes,
        ownerUserId: user.id,
        visibility: parseVisibility(body?.visibility),
      });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to save fit') });
    }
  });

  app.post('/api/fits/:id/quote', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const hub = parseHub((req.body as { hub?: string } | undefined)?.hub);
    if (!hub) return reply.code(400).send({ error: 'hub must be "jita" or "amarr"' });
    const fit = await store.get(id);
    if (!fit) return reply.code(404).send({ error: 'fit not found' });
    if (!canViewFit(fit, user)) return reply.code(403).send({ error: 'not allowed' });
    try {
      return quote(fit, hub);
    } catch (err) {
      return reply.code(500).send({ error: errorMessage(err, 'failed to quote fit') });
    }
  });

  app.post('/api/fits/:id/send', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;

    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const characterId = cleanPositiveNumber((req.body as { characterId?: number } | undefined)?.characterId);
    if (!characterId) return reply.code(400).send({ error: 'characterId is required' });
    if (!(await requireOwnedCharacter(user.id, characterId, reply, owns))) return reply;
    const fit = await store.get(id);
    if (!fit) return reply.code(404).send({ error: 'fit not found' });
    if (!canViewFit(fit, user)) return reply.code(403).send({ error: 'not allowed' });
    return sendFit(reply, fit, characterId, createFitting);
  });

  app.get('/api/fits/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const fit = await store.get(id);
    if (!fit) return reply.code(404).send({ error: 'fit not found' });
    if (!canViewFit(fit, user)) return reply.code(403).send({ error: 'not allowed' });
    return fit;
  });

  app.put('/api/fits/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'fit not found' });
    if (!canEditFit(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    try {
      const body = req.body as { rawEft?: string; shipTypeId?: number; fitName?: string; notes?: string } | undefined;
      const rawError = body?.rawEft == null ? null : validateRawEft(body.rawEft);
      if (rawError) return reply.code(400).send({ error: rawError });
      const fit = await store.update(id, {
        rawEft: body?.rawEft,
        shipTypeId: cleanPositiveNumber(body?.shipTypeId),
        fitName: body?.fitName,
        notes: body?.notes,
      });
      if (!fit) return reply.code(404).send({ error: 'fit not found' });
      return fit;
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err, 'failed to update fit') });
    }
  });

  app.delete('/api/fits/:id', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'fit not found' });
    if (!canEditFit(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    if (!(await store.delete(id))) return reply.code(404).send({ error: 'fit not found' });
    return { ok: true };
  });

  app.post('/api/fits/:id/publish', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'fit not found' });
    if (!canEditFit(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    return await store.publish(id);
  });

  app.post('/api/fits/:id/copy-private', async (req, reply) => {
    const user = await requireUser(req, reply, currentUser);
    if (!user) return reply;
    const id = parseId(req.params);
    if (!id) return reply.code(400).send({ error: 'valid fit id is required' });
    const existing = await store.get(id);
    if (!existing) return reply.code(404).send({ error: 'fit not found' });
    if (!canViewFit(existing, user)) return reply.code(403).send({ error: 'not allowed' });
    return await store.copyToPrivate(id, user.id);
  });
}

async function sendFit(
  reply: FastifyReply,
  fit: FitDraft & { notes?: string },
  characterId: number,
  createFitting: (characterId: number, payload: EsiFittingCreatePayload) => Promise<number | null>,
) {
  try {
    const payload = buildEsiFittingPayload(fit);
    if (payload.items.length === 0) return reply.code(400).send({ error: 'fit has no exportable items' });
    const fittingId = await createFitting(characterId, payload);
    return {
      ok: true,
      fittingId,
      excludedCount: excludedItemCount(fit),
      warnings: fit.warnings,
    };
  } catch (err) {
    const e = err as { status?: number; message?: string; body?: string };
    const status = e.status ?? 500;
    const reauthHint = status === 403 || (e.body ?? '').includes('esi-fittings.write_fittings.v1')
      ? 'Pilot is missing the esi-fittings.write_fittings.v1 scope. Click Add character on that alt to re-auth.'
      : null;
    return reply.code(status).send({
      error: e.message ?? 'failed to create in-game fitting',
      reauthHint,
    });
  }
}

function applyDraftOverrides(
  draft: FitDraft,
  body: { fitName?: string; notes?: string },
): FitDraft & { notes?: string } {
  const fitName = body.fitName?.trim() || draft.fitName;
  return { ...draft, fitName, notes: body.notes };
}

function excludedItemCount(fit: FitDraft): number {
  return fit.items.filter(item => item.typeId == null || item.slotFlag == null).length;
}

function parseHub(raw: string | undefined): HubKey | null {
  const hub = String(raw ?? '').toLowerCase() as HubKey;
  return HUBS[hub] ? hub : null;
}

function parseVisibility(raw: string | undefined): LibraryVisibility {
  return raw === 'public' ? 'public' : 'private';
}

function validateRawEft(rawEft: unknown): string | null {
  if (typeof rawEft !== 'string' || rawEft.length === 0) return 'rawEft is required';
  if (rawEft.length > MAX_RAW_EFT_CHARS) return RAW_EFT_TOO_LARGE;

  let lines = 1;
  for (let i = 0; i < rawEft.length; i++) {
    if (rawEft.charCodeAt(i) === 10 && ++lines > MAX_RAW_EFT_LINES) return RAW_EFT_TOO_LARGE;
  }
  return null;
}

function missingFitStore(): never {
  throw new Error('registerFitRoutes requires a fit store');
}

function canViewFit(fit: SavedFitDetail, user: { id: string; role: 'user' | 'admin' }): boolean {
  return fit.visibility === 'public' || canEditFit(fit, user);
}

function canEditFit(fit: SavedFitDetail, user: { id: string; role: 'user' | 'admin' }): boolean {
  return user.role === 'admin' || fit.ownerUserId === user.id;
}

function parseId(params: unknown): number | null {
  const id = Number((params as { id?: string })?.id);
  return cleanPositiveNumber(id) ?? null;
}

function cleanPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function pyfaImportErrorStatus(message: string): number {
  if (message === PYFA_IMAGE_IMPORT_NOT_CONFIGURED) return 503;
  if (message.startsWith('pyfa_image_import_provider_')) return 502;
  return 400;
}
