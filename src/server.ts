import 'dotenv/config';
import Fastify, { type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
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
import { registerDiscordImportRoutes } from './routes/discord-import.ts';
import { registerFitRoutes } from './routes/fits.ts';
import { registerAssetsRoutes } from './routes/assets.ts';
import { createPostgresAssetSnapshotStore } from './assets/store.ts';
import { createPostgresDoctrineStore } from './fits/doctrines.ts';
import { createPostgresFitStore } from './fits/store.ts';
import { startPolling } from './polling/scheduler.ts';
import { bootstrapSystemsCache } from './esi/universe.ts';
import { startContractIndexer } from './contracts/indexer.ts';
import { createPostgresSavedSkillPlanStore } from './skills/saved-plans-store.ts';
import {
  cookieSecretFromEnv,
  htmlCacheControlForPath,
  isSensitiveFallbackPath,
  secureCookiesFromEnv,
  serverListenOptionsFromEnv,
} from './server-config.ts';

const app = Fastify({ logger: true });
const characterStore = createPostgresCharacterStore();
const savedSkillPlans = createPostgresSavedSkillPlanStore();
const fitStore = createPostgresFitStore();
const doctrineStore = createPostgresDoctrineStore(undefined, { fitStore });
const assetSnapshotStore = createPostgresAssetSnapshotStore();

setPilotAccessCharacterStore(characterStore);
setAccessTokenCharacterStore(characterStore);

await app.register(cookie, { secret: cookieSecretFromEnv() });

registerAppAuthRoutes(app, { secureCookies: secureCookiesFromEnv() });
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
registerDiscordImportRoutes(app, { fitStore });
registerDoctrineRoutes(app, { store: doctrineStore, fitStore });
registerAssetsRoutes(app, { characters: characterStore, store: assetSnapshotStore });

app.get('/api/health', async () => ({ ok: true }));

// In dev, Vite serves the frontend on its own port. In production, serve the built bundle.
const serverDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(serverDir, '..', 'web', 'dist');
const publicDir = resolve(serverDir, '..', 'web', 'public');

async function sendLegalPage(reply: FastifyReply, filename: string) {
  try {
    const html = await readFile(resolve(distDir, filename), 'utf8');
    return reply
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .type('text/html; charset=utf-8')
      .send(html);
  } catch {
    const html = await readFile(resolve(publicDir, filename), 'utf8');
    return reply
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .type('text/html; charset=utf-8')
      .send(html);
  }
}

app.get('/terms-of-service', async (_req, reply) => sendLegalPage(reply, 'terms-of-service.html'));
app.get('/privacy-policy', async (_req, reply) => sendLegalPage(reply, 'privacy-policy.html'));

try {
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    setHeaders: (res, pathname) => {
      const cacheControl = htmlCacheControlForPath(pathname);
      if (cacheControl) res.setHeader('Cache-Control', cacheControl);
    },
  });
  app.setNotFoundHandler((req, reply) => {
    const isPasswordResetPage = req.url.startsWith('/auth/password/reset');
    if (
      req.url.startsWith('/api')
      || (req.url.startsWith('/auth') && !isPasswordResetPage)
      || isSensitiveFallbackPath(req.url)
    ) {
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

app.listen(serverListenOptionsFromEnv()).catch(err => {
  app.log.error(err);
  process.exit(1);
});
