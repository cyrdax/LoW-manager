import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerSsoRoutes } from './auth/sso.ts';
import { registerCharacterRoutes } from './routes/characters.ts';
import { registerFleetRoutes } from './routes/fleet.ts';
import { registerStreamRoute } from './routes/stream.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerAutopilotRoutes } from './routes/autopilot.ts';
import { registerPlanetRoutes } from './routes/planets.ts';
import { registerSkillsRoutes } from './routes/skills.ts';
import { registerMarketRoutes } from './routes/market.ts';
import { startPolling } from './polling/scheduler.ts';
import { bootstrapSystemsCache } from './esi/universe.ts';

const app = Fastify({ logger: true });

await app.register(cookie, { secret: process.env.COOKIE_SECRET ?? 'dev-secret' });

registerSsoRoutes(app);
registerCharacterRoutes(app);
registerFleetRoutes(app);
registerStreamRoute(app);
registerSearchRoutes(app);
registerAutopilotRoutes(app);
registerPlanetRoutes(app);
registerSkillsRoutes(app);
registerMarketRoutes(app);

// In dev, Vite serves the frontend on its own port. In production, serve the built bundle.
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
try {
  await app.register(fastifyStatic, { root: distDir, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/auth')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
} catch {
  app.log.warn(`No built frontend at ${distDir}; running in dev mode (use vite on port 5173).`);
}

startPolling();
bootstrapSystemsCache()
  .then(count => app.log.info(`[systems] cache has ${count} solar systems`))
  .catch(err => app.log.warn(`[systems] bootstrap failed: ${err.message}`));

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '127.0.0.1' }).catch(err => {
  app.log.error(err);
  process.exit(1);
});
