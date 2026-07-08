import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadMasteryData, type MasteryData } from '../skills/mastery-data.ts';
import {
  CONTRACT_RADIUS_DEFAULT,
  runContractSearch,
  searchContractShips,
  type ContractSearchResponse,
  type RunContractSearchInput,
} from '../contracts/search.ts';

const shipQuery = z.object({
  q: z.string().optional(),
});

const searchQuery = z.object({
  shipId: z.coerce.number().int().positive(),
  originSystemId: z.coerce.number().int().positive(),
  radius: z.coerce.number().int().default(CONTRACT_RADIUS_DEFAULT),
});

export interface ContractRouteDeps {
  loadData?: () => MasteryData;
  runSearch?: (input: RunContractSearchInput) => Promise<ContractSearchResponse>;
}

export function registerContractRoutes(app: FastifyInstance, deps: ContractRouteDeps = {}) {
  const loadData = deps.loadData ?? loadMasteryData;
  const runSearch = deps.runSearch ?? runContractSearch;

  app.get<{ Querystring: { q?: string } }>('/api/contracts/ships', async (req, reply) => {
    const parsed = shipQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return searchContractShips(loadData(), parsed.data.q ?? '');
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/contracts/search', async (req, reply) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    try {
      return await runSearch({
        data: loadData(),
        shipId: parsed.data.shipId,
        originSystemId: parsed.data.originSystemId,
        radius: parsed.data.radius,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search contracts';
      if (message === 'Ship not found') return reply.code(404).send({ error: message });
      if (message.includes('radius must be between')) return reply.code(400).send({ error: message });
      if (message.includes('origin system ') && message.includes(' is not present in contract map topology')) {
        return reply.code(400).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  });
}
