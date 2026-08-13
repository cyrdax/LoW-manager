import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadMasteryData, type MasteryData } from '../skills/mastery-data.ts';
import { getContractDetails, type ContractDetails, type GetContractDetailsInput } from '../contracts/detail.ts';
import { HUBS, type HubKey } from '../market/pricing.ts';
import {
  CONTRACT_RADIUS_DEFAULT,
  CONTRACT_RADIUS_MAX,
  CONTRACT_RADIUS_MIN,
  runContractSearch,
  runJumpCapableContractSearch,
  searchContractShips,
  type ContractSearchResponse,
  type RunJumpCapableContractSearchInput,
  type RunContractSearchInput,
} from '../contracts/search.ts';

const shipQuery = z.object({
  q: z.string().optional(),
});

const searchQuery = z.object({
  shipId: z.coerce.number().int().positive(),
  originSystemId: z.coerce.number().int().positive(),
  radius: z.coerce.number().int().min(CONTRACT_RADIUS_MIN).max(CONTRACT_RADIUS_MAX).default(CONTRACT_RADIUS_DEFAULT),
});

const jumpCapableSearchQuery = z.object({
  originSystemId: z.coerce.number().int().positive(),
});

export interface ContractRouteDeps {
  loadData?: () => MasteryData;
  runSearch?: (input: RunContractSearchInput) => Promise<ContractSearchResponse>;
  runJumpSearch?: (input: RunJumpCapableContractSearchInput) => Promise<ContractSearchResponse>;
  getDetails?: (input: GetContractDetailsInput) => Promise<ContractDetails>;
}

export function registerContractRoutes(app: FastifyInstance, deps: ContractRouteDeps = {}) {
  const loadData = deps.loadData ?? loadMasteryData;
  const runSearch = deps.runSearch ?? runContractSearch;
  const runJumpSearch = deps.runJumpSearch ?? runJumpCapableContractSearch;
  const loadDetails = deps.getDetails ?? getContractDetails;

  app.get<{ Querystring: { q?: string } }>('/api/contracts/ships', async (req, reply) => {
    const parsed = shipQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return searchContractShips(loadData(), parsed.data.q ?? '');
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/contracts/search', async (req, reply) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const controller = new AbortController();
    const abortRequest = () => {
      if (!controller.signal.aborted) controller.abort(new Error('Request aborted by client'));
    };

    req.raw.on('aborted', abortRequest);
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) abortRequest();
    });

    try {
      return await runSearch({
        data: loadData(),
        shipId: parsed.data.shipId,
        originSystemId: parsed.data.originSystemId,
        radius: parsed.data.radius,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        reply.hijack();
        return reply;
      }

      const message = err instanceof Error ? err.message : 'Failed to search contracts';
      if (message === 'Ship not found') return reply.code(404).send({ error: message });
      if (message.includes('origin system ') && message.includes(' is not present in contract map topology')) {
        return reply.code(400).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/contracts/search/jump-capable', async (req, reply) => {
    const parsed = jumpCapableSearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const controller = new AbortController();
    const abortRequest = () => {
      if (!controller.signal.aborted) controller.abort(new Error('Request aborted by client'));
    };

    req.raw.on('aborted', abortRequest);
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) abortRequest();
    });

    try {
      return await runJumpSearch({
        data: loadData(),
        originSystemId: parsed.data.originSystemId,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        reply.hijack();
        return reply;
      }

      const message = err instanceof Error ? err.message : 'Failed to search jump-capable contracts';
      if (message.includes('origin system ') && message.includes(' is not present in contract map topology')) {
        return reply.code(400).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.get<{ Params: { contractId: string }; Querystring: { hub?: string } }>(
    '/api/contracts/:contractId/details',
    async (req, reply) => {
      const contractId = Number(req.params.contractId);
      if (!Number.isInteger(contractId) || contractId <= 0) {
        return reply.code(400).send({ error: 'contractId must be a positive integer' });
      }

      const hub = (req.query.hub ?? 'jita').toLowerCase() as HubKey;
      if (!HUBS[hub]) return reply.code(400).send({ error: 'hub must be "jita" or "amarr"' });

      try {
        return await loadDetails({
          data: loadData(),
          contractId,
          hub,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load contract details';
        if (message === 'Contract not found') return reply.code(404).send({ error: message });
        return reply.code(500).send({ error: message });
      }
    },
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
