import type { FastifyInstance } from 'fastify';
import { createSqliteCharacterStore, type AsyncCharacterStore, type CharacterStore } from '../characters/store.ts';
import { SCOPE_STRING } from './scopes.ts';
import { characterIdFromSub, verifyEveJwt } from './jwt.ts';
import { createCurrentUserResolver, type CurrentUserResolver } from './current-user.ts';
import { createOAuthStateStore, type OAuthStateStore } from './oauth-state-store.ts';

const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${env('EVE_CLIENT_ID')}:${env('EVE_CLIENT_SECRET')}`).toString('base64');
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: 'Bearer';
}

export interface SsoRouteDeps {
  oauthStates?: OAuthStateStore;
  currentUser?: CurrentUserResolver;
  characters?: CharacterStore | AsyncCharacterStore;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    },
    body,
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export function registerSsoRoutes(app: FastifyInstance, deps: SsoRouteDeps = {}) {
  const oauthStates = () => deps.oauthStates ?? createOAuthStateStore();
  const characterStore = () => deps.characters ?? createSqliteCharacterStore();
  let defaultCurrentUser: CurrentUserResolver | null = null;
  const currentUser = () => deps.currentUser ?? (defaultCurrentUser ??= createCurrentUserResolver());

  app.get('/auth/login', async (req, reply) => {
    const user = await currentUser()(req);
    if (!user) {
      return reply.code(401).type('text/html').send(`
        <!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
          <h2>Sign in required</h2>
          <p>Sign in to the dashboard before adding an EVE pilot.</p>
        </body></html>
      `);
    }

    const state = await oauthStates().issue({ userId: user.id });
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: env('EVE_CALLBACK_URL'),
      client_id: env('EVE_CLIENT_ID'),
      scope: SCOPE_STRING,
      state,
    });
    return reply.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/callback', async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state) return reply.code(400).send('Missing code/state');

    const stateMetadata = await oauthStates().consume(state);
    const userId = typeof stateMetadata?.userId === 'string' ? stateMetadata.userId : null;
    if (!userId) return reply.code(400).send('Invalid state');

    const tokens = await exchangeCode(code);
    const claims = await verifyEveJwt(tokens.access_token);
    const characterId = characterIdFromSub(claims.sub);
    const scopes = Array.isArray(claims.scp) ? claims.scp.join(' ') : claims.scp;
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    await characterStore().upsertAuthorized({
      characterId,
      userId,
      characterName: claims.name,
      ownerHash: claims.owner,
      scopes,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
    });

    return reply.type('text/html').send(`
      <!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
        <h2>Authenticated: ${escapeHtml(claims.name)}</h2>
        <p>You can close this tab.</p>
        <script>setTimeout(() => window.close(), 800);</script>
      </body></html>
    `);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
