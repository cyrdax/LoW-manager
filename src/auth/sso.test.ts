import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { AuthorizedCharacterInput } from '../characters/store.ts';
import { CharacterOwnershipError } from '../characters/store.ts';
import type { AppUser } from './user-store.ts';
import type { EveAccountAuthInput, EveAccountAuthService } from './eve-account-auth.ts';
import { EveAccountAuthError } from './eve-account-auth.ts';
import type { EveJwtClaims } from './jwt.ts';
import type { OAuthStateStore } from './oauth-state-store.ts';
import type { IssuedSession, SessionMetadata, SessionStore, UserSession } from './session-store.ts';
import { registerSsoRoutes } from './sso.ts';

function withEveEnv(fn: () => Promise<void>) {
  return async () => {
    const original = {
      EVE_CLIENT_ID: process.env.EVE_CLIENT_ID,
      EVE_CLIENT_SECRET: process.env.EVE_CLIENT_SECRET,
      EVE_CALLBACK_URL: process.env.EVE_CALLBACK_URL,
    };
    process.env.EVE_CLIENT_ID = 'client-id';
    process.env.EVE_CLIENT_SECRET = 'client-secret';
    process.env.EVE_CALLBACK_URL = 'http://localhost:3100/auth/callback';
    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

test('EVE account start works signed out and stores only safe account-intent state', withEveEnv(async () => {
  const states = new FakeOAuthStateStore();
  const app = Fastify();
  registerSsoRoutes(app, { oauthStates: states, currentUser: async () => null });

  const response = await app.inject({
    method: 'GET',
    url: '/auth/eve/start?intent=account&returnTo=%2Ffits%3Fmode%3Dfits',
  });

  assert.equal(response.statusCode, 302);
  const authorizationUrl = new URL(String(response.headers.location));
  assert.equal(authorizationUrl.origin, 'https://login.eveonline.com');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-1');
  const requestedScopes = authorizationUrl.searchParams.get('scope')?.split(' ') ?? [];
  assert.ok(requestedScopes.includes('esi-assets.read_assets.v1'));
  assert.ok(!requestedScopes.includes('esi-mail.send_mail.v1'));
  assert.deepEqual(states.issued[0], { provider: 'eve', intent: 'account', returnTo: '/fits?mode=fits' });

  await app.inject({ method: 'GET', url: '/auth/eve/start?intent=account&returnTo=https%3A%2F%2Fevil.example' });
  assert.equal(states.issued[1]?.returnTo, '/');
  await app.close();
}));

test('EVE add-pilot start requires a user and legacy login remains an alias', withEveEnv(async () => {
  const states = new FakeOAuthStateStore();
  const denied = Fastify();
  registerSsoRoutes(denied, { oauthStates: states, currentUser: async () => null });
  const deniedResponse = await denied.inject({ method: 'GET', url: '/auth/eve/start?intent=add_pilot' });
  assert.equal(deniedResponse.statusCode, 401);
  assert.equal(states.issued.length, 0);
  await denied.close();

  const app = Fastify();
  registerSsoRoutes(app, {
    oauthStates: states,
    currentUser: async () => ({ id: 'user-1', email: null, role: 'user', status: 'active' }),
  });
  const canonical = await app.inject({ method: 'GET', url: '/auth/eve/start?intent=add_pilot' });
  const legacy = await app.inject({ method: 'GET', url: '/auth/login' });

  assert.equal(canonical.statusCode, 302);
  assert.equal(legacy.statusCode, 302);
  assert.deepEqual(states.issued, [
    { provider: 'eve', intent: 'add_pilot', userId: 'user-1' },
    { provider: 'eve', intent: 'add_pilot', userId: 'user-1' },
  ]);
  await app.close();
}));

test('EVE account callback creates the normal app session and redirects locally', withEveEnv(async () => {
  const states = new FakeOAuthStateStore();
  states.nextConsumed = { provider: 'eve', intent: 'account', returnTo: '/fits' };
  const sessions = new FakeSessionStore();
  const eveAccounts = new FakeEveAccountAuthService();
  const markedActive: string[] = [];
  const app = Fastify();
  await app.register(cookie, { secret: 'test-cookie-secret' });
  registerSsoRoutes(app, {
    oauthStates: states,
    eveAccounts,
    sessions,
    users: { markActive: async userId => { markedActive.push(userId); return appUser(); } },
    exchangeCode: async () => tokenResponse(),
    verifyToken: async () => claims(),
    secureCookies: false,
    now: () => 0,
  });

  const response = await app.inject({
    method: 'GET',
    url: '/auth/callback?code=oauth-code&state=state-1',
    headers: { 'user-agent': 'eve-test-agent' },
  });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/fits');
  assert.deepEqual(eveAccounts.completed[0], {
    characterId: 9001,
    characterName: 'Aura Example',
    ownerHash: 'owner-a',
    scopes: 'esi-assets.read_assets.v1 esi-location.read_location.v1',
    refreshToken: 'refresh-token',
    accessToken: 'access-token',
    accessTokenExpiresAt: 1_200_000,
  });
  assert.equal(sessions.created[0]?.userId, 'user-1');
  assert.equal(sessions.created[0]?.metadata?.userAgentHash?.length, 64);
  assert.deepEqual(markedActive, ['user-1']);
  assert.match(String(response.headers['set-cookie']), /^efd_session=/);
  assert.match(String(response.headers['set-cookie']), /HttpOnly/);
  assert.match(String(response.headers['set-cookie']), /SameSite=Lax/);
  await app.close();
}));

test('EVE callback rejects replayed state before exchanging a code', withEveEnv(async () => {
  const states = new FakeOAuthStateStore();
  let exchangeCalls = 0;
  const app = Fastify();
  registerSsoRoutes(app, {
    oauthStates: states,
    exchangeCode: async () => { exchangeCalls += 1; return tokenResponse(); },
    verifyToken: async () => claims(),
  });

  const response = await app.inject({ method: 'GET', url: '/auth/callback?code=abc&state=replayed' });

  assert.equal(response.statusCode, 400);
  assert.equal(exchangeCalls, 0);
  assert.doesNotMatch(response.body, /replayed/);
  await app.close();
}));

test('EVE add-pilot callback stores the pilot and preserves close-window behavior', withEveEnv(async () => {
  const states = new FakeOAuthStateStore();
  states.nextConsumed = { provider: 'eve', intent: 'add_pilot', userId: 'user-1' };
  const authorized: AuthorizedCharacterInput[] = [];
  const app = Fastify();
  registerSsoRoutes(app, {
    oauthStates: states,
    characters: {
      upsertAuthorized: async (input: AuthorizedCharacterInput) => { authorized.push(input); return characterRow(input); },
    } as never,
    exchangeCode: async () => tokenResponse(),
    verifyToken: async () => claims(),
    now: () => 0,
  });

  const response = await app.inject({ method: 'GET', url: '/auth/callback?code=abc&state=state-1' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Authenticated: Aura Example/);
  assert.match(response.body, /window\.close/);
  assert.equal(authorized[0]?.userId, 'user-1');
  assert.equal(authorized[0]?.ownerHash, 'owner-a');
  await app.close();
}));

test('EVE callback maps owner and provider failures to neutral browser responses', withEveEnv(async () => {
  const mismatchStates = new FakeOAuthStateStore();
  mismatchStates.nextConsumed = { provider: 'eve', intent: 'account', returnTo: '/' };
  const mismatchApp = Fastify();
  registerSsoRoutes(mismatchApp, {
    oauthStates: mismatchStates,
    eveAccounts: { complete: async () => { throw new EveAccountAuthError('eve_owner_mismatch'); } },
    exchangeCode: async () => tokenResponse(),
    verifyToken: async () => claims(),
  });
  const mismatch = await mismatchApp.inject({ method: 'GET', url: '/auth/callback?code=abc&state=state-1' });
  assert.equal(mismatch.statusCode, 302);
  assert.equal(mismatch.headers.location, '/?auth_error=eve_owner_mismatch');
  assert.doesNotMatch(String(mismatch.headers.location), /owner-a/);
  await mismatchApp.close();

  const pilotStates = new FakeOAuthStateStore();
  pilotStates.nextConsumed = { provider: 'eve', intent: 'add_pilot', userId: 'user-2' };
  const pilotApp = Fastify();
  registerSsoRoutes(pilotApp, {
    oauthStates: pilotStates,
    characters: {
      upsertAuthorized: async (input: AuthorizedCharacterInput) => { throw new CharacterOwnershipError(input.characterId); },
    } as never,
    exchangeCode: async () => tokenResponse(),
    verifyToken: async () => claims(),
  });
  const collision = await pilotApp.inject({ method: 'GET', url: '/auth/callback?code=abc&state=state-2' });
  assert.equal(collision.statusCode, 409);
  assert.match(collision.body, /could not be linked/i);
  assert.doesNotMatch(collision.body, /user-1|user-2|owner-a/);
  await pilotApp.close();

  const providerStates = new FakeOAuthStateStore();
  providerStates.nextConsumed = { provider: 'eve', intent: 'account', returnTo: '/' };
  const providerApp = Fastify();
  registerSsoRoutes(providerApp, {
    oauthStates: providerStates,
    exchangeCode: async () => { throw new Error('secret provider response'); },
    verifyToken: async () => claims(),
  });
  const providerFailure = await providerApp.inject({ method: 'GET', url: '/auth/callback?code=abc&state=state-3' });
  assert.equal(providerFailure.statusCode, 302);
  assert.equal(providerFailure.headers.location, '/?auth_error=eve_auth_failed');
  assert.doesNotMatch(String(providerFailure.headers.location), /secret/);
  await providerApp.close();
}));

class FakeOAuthStateStore implements OAuthStateStore {
  issued: Array<Record<string, unknown>> = [];
  nextConsumed: Record<string, unknown> | null = null;

  async issue(metadata: Record<string, unknown> = {}): Promise<string> {
    this.issued.push(metadata);
    return `state-${this.issued.length}`;
  }

  async consume(): Promise<Record<string, unknown> | null> {
    const value = this.nextConsumed;
    this.nextConsumed = null;
    return value;
  }

  async deleteExpired(): Promise<number> { return 0; }
}

class FakeEveAccountAuthService implements EveAccountAuthService {
  completed: EveAccountAuthInput[] = [];

  async complete(input: EveAccountAuthInput) {
    this.completed.push(input);
    return { user: appUser(), created: true, backfilled: false };
  }
}

class FakeSessionStore implements SessionStore {
  created: Array<{ userId: string; metadata?: SessionMetadata }> = [];

  async create(userId: string, metadata?: SessionMetadata): Promise<IssuedSession> {
    this.created.push({ userId, metadata });
    return { token: 'session-token', session: session(userId) };
  }

  async findByToken() { return null; }
  async touch() {}
  async revoke() {}
  async deleteExpired() { return 0; }
}

function tokenResponse() {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 1200,
    token_type: 'Bearer' as const,
  };
}

function claims(): EveJwtClaims {
  return {
    sub: 'CHARACTER:EVE:9001',
    name: 'Aura Example',
    owner: 'owner-a',
    scp: ['esi-assets.read_assets.v1', 'esi-location.read_location.v1'],
    exp: 999999,
    iss: 'login.eveonline.com',
    aud: 'EVE Online',
  };
}

function appUser(): AppUser {
  return {
    id: 'user-1',
    email: null,
    emailVerifiedAt: null,
    role: 'user',
    status: 'active',
    mainCharacterId: 9001,
    lastActiveAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
}

function session(userId: string): UserSession {
  return {
    id: 'session-1',
    userId,
    tokenHash: 'hash',
    createdAt: new Date(0),
    expiresAt: new Date(1),
    revokedAt: null,
    lastSeenAt: null,
    ipHash: null,
    userAgentHash: null,
  };
}

function characterRow(input: AuthorizedCharacterInput) {
  return {
    character_id: input.characterId,
    user_id: input.userId,
    character_name: input.characterName,
    owner_hash: input.ownerHash,
    scopes: input.scopes,
    refresh_token: input.refreshToken,
    access_token: input.accessToken,
    access_token_expires_at: input.accessTokenExpiresAt,
    added_at: 0,
    needs_reauth: 0,
    is_boss: 0,
  };
}
