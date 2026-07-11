import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerAppAuthRoutes } from './auth/app-auth-routes.ts';
import { setPilotAccessCharacterStore } from './auth/pilot-access.ts';
import { registerSsoRoutes } from './auth/sso.ts';
import { setAccessTokenCharacterStore } from './auth/tokens.ts';
import { createPostgresCharacterStore } from './characters/store.ts';
import { registerCharacterRoutes } from './routes/characters.ts';
import { registerFleetRoutes } from './routes/fleet.ts';
import { registerStreamRoute } from './routes/stream.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerAutopilotRoutes } from './routes/autopilot.ts';
import { registerPlanetRoutes } from './routes/planets.ts';
import { registerSkillsRoutes } from './routes/skills.ts';
import { registerMarketRoutes } from './routes/market.ts';
import { registerIndustryRoutes } from './routes/industry.ts';
import { registerContractRoutes } from './routes/contracts.ts';
import { registerDoctrineRoutes } from './routes/doctrines.ts';
import { registerFitRoutes } from './routes/fits.ts';
import { createPostgresFitStore } from './fits/store.ts';
import { startPolling } from './polling/scheduler.ts';
import { bootstrapSystemsCache } from './esi/universe.ts';
import { startContractIndexer } from './contracts/indexer.ts';
import { createPostgresSavedSkillPlanStore } from './skills/saved-plans-store.ts';

const app = Fastify({ logger: true });
const characterStore = createPostgresCharacterStore();
const savedSkillPlans = createPostgresSavedSkillPlanStore();
const fitStore = createPostgresFitStore();

setPilotAccessCharacterStore(characterStore);
setAccessTokenCharacterStore(characterStore);

await app.register(cookie, { secret: process.env.COOKIE_SECRET ?? 'dev-secret' });

registerAppAuthRoutes(app);
registerSsoRoutes(app, { characters: characterStore });
registerCharacterRoutes(app, { characters: characterStore });
registerFleetRoutes(app);
registerStreamRoute(app, { characters: characterStore });
registerSearchRoutes(app);
registerAutopilotRoutes(app);
registerPlanetRoutes(app);
registerSkillsRoutes(app, { savedPlans: savedSkillPlans });
registerMarketRoutes(app);
registerIndustryRoutes(app);
registerContractRoutes(app);
registerFitRoutes(app, { store: fitStore });
registerDoctrineRoutes(app);

// In dev, Vite serves the frontend on its own port. In production, serve the built bundle.
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
try {
  await app.register(fastifyStatic, { root: distDir, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    const isPasswordResetPage = req.url.startsWith('/auth/password/reset');
    if (req.url.startsWith('/api') || (req.url.startsWith('/auth') && !isPasswordResetPage)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
} catch {
  app.log.warn(`No built frontend at ${distDir}; running in dev mode (use vite on port 5173).`);
}

startPolling({ characters: characterStore });
try {
  startContractIndexer({ logger: app.log });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  app.log.warn(`[contracts] indexer not started: ${message}`);
}
bootstrapSystemsCache()
  .then(count => app.log.info(`[systems] cache has ${count} solar systems`))
  .catch(err => app.log.warn(`[systems] bootstrap failed: ${err.message}`));

const port = Number(process.env.PORT ?? 3100);
app.listen({ port, host: '127.0.0.1' }).catch(err => {
  app.log.error(err);
  process.exit(1);
});
