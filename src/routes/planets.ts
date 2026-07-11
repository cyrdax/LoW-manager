import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPlanetPublic, getSystemInfo, resolveSchematic, resolveSystem, resolveType } from '../esi/universe.ts';
import { allColonyPins, getColonyPins, snapshot } from '../polling/scheduler.ts';
import { classifyTier, extractablesFor, type PiTier } from '../esi/pi-data.ts';
import type { PlanetPin, PlanetType } from '../esi/planets.ts';
import { createSavedSystemsStore, type SavedSystemsStore } from '../planets/saved-systems-store.ts';

async function buildSystemPlanetList(systemId: number, overlay: Map<number, MyColonyOverlay[]>) {
  const system = await getSystemInfo(systemId);
  const planetIds = (system.planets ?? []).map(p => p.planet_id);
  const planets = await Promise.all(planetIds.map(async pid => {
    const p = await getPlanetPublic(pid).catch(() => null);
    if (!p) {
      return {
        planetId: pid,
        name: `#${pid}`,
        planetType: 'unknown' as PlanetType | 'unknown',
        extractables: [],
        myColonies: overlay.get(pid) ?? [],
      };
    }
    const typeName = await resolveType(p.type_id).catch(() => `Type ${p.type_id}`);
    const planetType = shortPlanetType(typeName) as PlanetType;
    return {
      planetId: pid,
      name: p.name,
      planetType,
      extractables: extractablesFor(planetType),
      myColonies: overlay.get(pid) ?? [],
    };
  }));
  return {
    systemId: system.system_id,
    systemName: system.name,
    securityStatus: system.security_status,
    planets,
  };
}

function overlayByPlanetId(): Map<number, MyColonyOverlay[]> {
  const m = new Map<number, MyColonyOverlay[]>();
  for (const c of snapshot()) {
    for (const col of c.colonies) {
      const list = m.get(col.planetId) ?? [];
      list.push({
        characterId: c.characterId,
        characterName: c.name,
        upgradeLevel: col.upgradeLevel,
        numPins: col.numPins,
        soonestExpiry: col.soonestExpiry,
        hasIdle: col.hasIdle,
      });
      m.set(col.planetId, list);
    }
  }
  return m;
}

const PLANET_TYPE_PREFIX = /^Planet \((.+)\)$/;

function shortPlanetType(name: string): string {
  const m = name.match(PLANET_TYPE_PREFIX);
  return (m ? m[1] : name).toLowerCase();
}

interface MyColonyOverlay {
  characterId: number;
  characterName: string;
  upgradeLevel: number;
  numPins: number;
  soonestExpiry: string | null;
  hasIdle: boolean;
}

export interface PlanetRouteDeps {
  savedSystems?: SavedSystemsStore;
}

export function registerPlanetRoutes(app: FastifyInstance, deps: PlanetRouteDeps = {}) {
  const savedSystems = () => deps.savedSystems ?? createSavedSystemsStore();

  app.get<{ Params: { id: string } }>('/api/planets/system/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid system id' });

    try {
      const block = await buildSystemPlanetList(id, overlayByPlanetId());
      return {
        system: { id: block.systemId, name: block.systemName, securityStatus: block.securityStatus },
        planets: block.planets,
      };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      return reply.code(e.status ?? 500).send({ error: e.message ?? 'failed to load system' });
    }
  });

  app.get<{ Params: { charId: string; planetId: string } }>(
    '/api/planets/colony/:charId/:planetId',
    async (req, reply) => {
      const charId = Number(req.params.charId);
      const planetId = Number(req.params.planetId);
      if (!Number.isFinite(charId) || !Number.isFinite(planetId)) {
        return reply.code(400).send({ error: 'invalid id' });
      }
      const entry = getColonyPins(charId, planetId);
      if (!entry) {
        return reply.code(404).send({ error: 'colony not yet polled — try again in a few seconds' });
      }

      const detail = await categorizePins(entry.pins);
      return {
        characterId: charId,
        planetId,
        fetchedAt: entry.fetchedAt,
        ...detail,
      };
    },
  );

  app.get('/api/planets/saved', async () => {
    const rows = await savedSystems().list();
    const overlay = overlayByPlanetId();
    const systems = await Promise.all(rows.map(async r => {
      const block = await buildSystemPlanetList(r.systemId, overlay).catch(() => null);
      if (!block) {
        return { systemId: r.systemId, systemName: r.systemName, securityStatus: 0, planets: [], savedAt: r.savedAt, error: 'failed to load' };
      }
      return { ...block, savedAt: r.savedAt };
    }));
    return { systems };
  });

  const saveSchema = z.object({ system_id: z.number().int() });
  app.post('/api/planets/saved', async (req, reply) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const systemId = parsed.data.system_id;

    if (await savedSystems().has(systemId)) return { ok: true, alreadySaved: true };

    let systemName: string;
    try { systemName = await resolveSystem(systemId); }
    catch (err) {
      const e = err as { status?: number; message?: string };
      return reply.code(e.status ?? 500).send({ error: e.message ?? 'failed to resolve system' });
    }

    await savedSystems().add(systemId, systemName);
    return { ok: true };
  });

  app.delete<{ Params: { systemId: string } }>('/api/planets/saved/:systemId', async (req, reply) => {
    const systemId = Number(req.params.systemId);
    if (!Number.isFinite(systemId)) return reply.code(400).send({ error: 'invalid system id' });
    await savedSystems().delete(systemId);
    return { ok: true };
  });

  app.get('/api/planets/inventory', async () => {
    type Bucket = { tier: PiTier; name: string; total: number; locations: Array<{ characterId: number; characterName: string; planetId: number; amount: number }> };
    const buckets = new Map<string, Bucket>();
    const charNames = new Map<number, string>();
    for (const c of snapshot()) charNames.set(c.characterId, c.name);

    const typeNameCache = new Map<number, string>();

    for (const entry of allColonyPins()) {
      for (const pin of entry.pins) {
        if (!pin.contents || pin.contents.length === 0) continue;
        for (const c of pin.contents) {
          let name = typeNameCache.get(c.type_id);
          if (!name) {
            name = await resolveType(c.type_id).catch(() => `Type ${c.type_id}`);
            typeNameCache.set(c.type_id, name);
          }
          let bucket = buckets.get(name);
          if (!bucket) {
            bucket = { tier: classifyTier(name), name, total: 0, locations: [] };
            buckets.set(name, bucket);
          }
          bucket.total += c.amount;
          bucket.locations.push({
            characterId: entry.characterId,
            characterName: charNames.get(entry.characterId) ?? `#${entry.characterId}`,
            planetId: entry.planetId,
            amount: c.amount,
          });
        }
      }
    }

    const all = Array.from(buckets.values()).sort((a, b) => {
      if (a.tier !== b.tier) return tierOrder(a.tier) - tierOrder(b.tier);
      return b.total - a.total;
    });
    return { items: all };
  });
}

function tierOrder(t: PiTier): number {
  return t === 'P0' ? 0 : t === 'P1' ? 1 : t === 'P2' ? 2 : 3;
}

interface CategorizedPin {
  pinId: number;
  typeName: string;
}
interface ExtractorPin extends CategorizedPin {
  productName: string | null;
  expiryTime: string | null;
  installTime: string | null;
  cycleSeconds: number | null;
}
interface FactoryPin extends CategorizedPin {
  schematicName: string | null;
  lastCycleStart: string | null;
}
interface StoragePin extends CategorizedPin {
  contents: Array<{ name: string; tier: PiTier; amount: number }>;
}

async function categorizePins(pins: PlanetPin[]): Promise<{
  extractors: ExtractorPin[];
  factories: FactoryPin[];
  storage: StoragePin[];
}> {
  const extractors: ExtractorPin[] = [];
  const factories: FactoryPin[] = [];
  const storage: StoragePin[] = [];

  for (const p of pins) {
    const typeName = await resolveType(p.type_id).catch(() => `Type ${p.type_id}`);

    // Extractor (control unit or head): has expiry_time / cycle_time / product_type_id
    if (p.expiry_time != null || p.cycle_time != null || p.product_type_id != null) {
      const productName = p.product_type_id
        ? await resolveType(p.product_type_id).catch(() => null)
        : null;
      extractors.push({
        pinId: p.pin_id,
        typeName,
        productName,
        expiryTime: p.expiry_time ?? null,
        installTime: p.install_time ?? null,
        cycleSeconds: p.cycle_time ?? null,
      });
      continue;
    }

    // Factory: has schematic_id (and usually last_cycle_start)
    if (p.schematic_id != null) {
      const schematicName = await resolveSchematic(p.schematic_id).catch(() => null);
      factories.push({
        pinId: p.pin_id,
        typeName,
        schematicName,
        lastCycleStart: p.last_cycle_start ?? null,
      });
      continue;
    }

    // Storage / Launchpad / Command Center: has contents
    if (p.contents && p.contents.length > 0) {
      const resolved = await Promise.all(
        p.contents.map(async c => {
          const name = await resolveType(c.type_id).catch(() => `Type ${c.type_id}`);
          return { name, tier: classifyTier(name), amount: c.amount };
        }),
      );
      storage.push({ pinId: p.pin_id, typeName, contents: resolved });
      continue;
    }

    // Empty storage / link / misc — skip
  }

  return { extractors, factories, storage };
}
