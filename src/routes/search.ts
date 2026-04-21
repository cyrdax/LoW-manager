import type { FastifyInstance } from 'fastify';
import { searchSystems } from '../esi/universe.ts';

export function registerSearchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>('/api/search/systems', async (req) => {
    return searchSystems(req.query.q ?? '', 3);
  });
}
