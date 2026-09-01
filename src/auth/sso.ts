import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CharacterOwnerMismatchError,
  CharacterOwnershipError,
  createSqliteCharacterStore,
  type AsyncCharacterStore,
  type AuthorizedCharacterInput,
  type CharacterStore,
} from '../characters/store.ts';
import { createCurrentUserResolver, SESSION_COOKIE, type CurrentUserResolver } from './current-user.ts';
import {
  createEveAccountAuthService,
  EveAccountAuthError,
  type EveAccountAuthService,
} from './eve-account-auth.ts';
import { characterIdFromSub, verifyEveJwt } from './jwt.ts';
import { createOAuthStateStore, type OAuthStateStore } from './oauth-state-store.ts';
import { SCOPE_STRING } from './scopes.ts';
import { safeLocalReturnTo, sessionMetadataForRequest, setSessionCookie } from './session-http.ts';
import { createSessionStore, type SessionStore } from './session-store.ts';
import { createUserStore, type UserStore } from './user-store.ts';

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

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: 'Bearer';
}

export interface SsoRouteDeps {
  oauthStates?: OAuthStateStore;
  currentUser?: CurrentUserResolver;
  characters?: CharacterStore | AsyncCharacterStore;
  eveAccounts?: EveAccountAuthService;
  sessions?: SessionStore;
  users?: Pick<UserStore, 'markActive'>;
  exchangeCode?: typeof exchangeCode;
  verifyToken?: typeof verifyEveJwt;
  sessionCookieName?: string;
  secureCookies?: boolean;
  now?: () => number;
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
  const oauthStates = deps.oauthStates ?? createOAuthStateStore();
  const characters = () => deps.characters ?? createSqliteCharacterStore();
  const eveAccounts = () => deps.eveAccounts ?? createEveAccountAuthService();
  const sessions = () => deps.sessions ?? createSessionStore();
  const users = () => deps.users ?? createUserStore();
  const exchange = deps.exchangeCode ?? exchangeCode;
  const verifyToken = deps.verifyToken ?? verifyEveJwt;
  const cookieName = deps.sessionCookieName ?? SESSION_COOKIE;
  const secureCookies = deps.secureCookies ?? process.env.NODE_ENV === 'production';
  const now = deps.now ?? (() => Date.now());
  let defaultCurrentUser: CurrentUserResolver | null = null;
  const currentUser = (req: FastifyRequest) => (
    deps.currentUser
      ?? (defaultCurrentUser ??= createCurrentUserResolver({ sessionCookieName: cookieName }))
  )(req);

  async function startAddPilot(req: FastifyRequest, reply: FastifyReply) {
    const user = await currentUser(req);
    if (!user || user.status !== 'active') return signInRequired(reply);
    const state = await oauthStates.issue({ provider: 'eve', intent: 'add_pilot', userId: user.id });
    return redirectToEve(reply, state);
  }

  app.get<{ Querystring: { intent?: string; returnTo?: string } }>('/auth/eve/start', async (req, reply) => {
    if (req.query.intent === 'account') {
      const state = await oauthStates.issue({
        provider: 'eve',
        intent: 'account',
        returnTo: safeLocalReturnTo(req.query.returnTo),
      });
      return redirectToEve(reply, state);
    }
    if (req.query.intent === 'add_pilot') return startAddPilot(req, reply);
    return reply.code(400).send({ error: 'invalid_eve_auth_intent' });
  });

  app.get('/auth/login', startAddPilot);

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (req, reply) => {
    if (req.query.error) return reply.redirect('/?auth_error=eve_auth_failed');
    const { code, state } = req.query;
    if (!code || !state) return reply.code(400).send('Invalid EVE authorization request');

    const stateMetadata = await oauthStates.consume(state);
    const intent = stateMetadata?.intent;
    if (!stateMetadata || stateMetadata.provider !== 'eve' || (intent !== 'account' && intent !== 'add_pilot')) {
      return reply.code(400).send('Invalid EVE authorization state');
    }

    let authorized: Omit<AuthorizedCharacterInput, 'userId'>;
    try {
      const tokens = await exchange(code);
      const claims = await verifyToken(tokens.access_token);
      authorized = {
        characterId: characterIdFromSub(claims.sub),
        characterName: claims.name,
        ownerHash: claims.owner,
        scopes: Array.isArray(claims.scp) ? claims.scp.join(' ') : claims.scp,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: now() + tokens.expires_in * 1000,
      };
    } catch {
      if (intent === 'account') return reply.redirect('/?auth_error=eve_auth_failed');
      return pilotLinkFailure(reply, 502);
    }

    if (intent === 'account') {
      try {
        const result = await eveAccounts().complete(authorized);
        const issued = await sessions().create(result.user.id, sessionMetadataForRequest(req));
        if (!issued) return reply.redirect('/?auth_error=account_not_active');
        setSessionCookie(reply, issued.token, { cookieName, secure: secureCookies });
        await users().markActive(result.user.id);
        return reply.redirect(safeLocalReturnTo(stateMetadata.returnTo));
      } catch (error) {
        if (error instanceof EveAccountAuthError) {
          return reply.redirect(`/?auth_error=${encodeURIComponent(error.code)}`);
        }
        return reply.redirect('/?auth_error=eve_auth_failed');
      }
    }

    const userId = typeof stateMetadata.userId === 'string' ? stateMetadata.userId : null;
    if (!userId) return reply.code(400).send('Invalid EVE authorization state');
    try {
      await characters().upsertAuthorized({ ...authorized, userId });
    } catch (error) {
      if (error instanceof CharacterOwnershipError || error instanceof CharacterOwnerMismatchError) {
        return pilotLinkFailure(reply, 409);
      }
      return pilotLinkFailure(reply, 500);
    }

    return reply.type('text/html').send(`
      <!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
        <h2>Authenticated: ${escapeHtml(authorized.characterName)}</h2>
        <p>You can close this tab.</p>
        <script>setTimeout(() => window.close(), 800);</script>
      </body></html>
    `);
  });

  function redirectToEve(reply: FastifyReply, state: string) {
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: env('EVE_CALLBACK_URL'),
      client_id: env('EVE_CLIENT_ID'),
      scope: SCOPE_STRING,
      state,
    });
    return reply.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  }
}

function signInRequired(reply: FastifyReply) {
  return reply.code(401).type('text/html').send(`
    <!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
      <h2>Sign in required</h2>
      <p>Sign in to the dashboard before adding an EVE pilot.</p>
    </body></html>
  `);
}

function pilotLinkFailure(reply: FastifyReply, status: number) {
  return reply.code(status).type('text/html').send(`
    <!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
      <h2>Pilot could not be linked</h2>
      <p>Return to the dashboard and try again, or contact support if the pilot is already linked.</p>
    </body></html>
  `);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
