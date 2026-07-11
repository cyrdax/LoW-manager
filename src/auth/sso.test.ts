import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerSsoRoutes } from './sso.ts';
import type { OAuthStateStore } from './oauth-state-store.ts';

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

test('EVE login issues OAuth state through the state store', withEveEnv(async () => {
  let issued = false;
  const store: OAuthStateStore = {
    issue: async () => { issued = true; return 'state-from-store'; },
    consume: async () => null,
    deleteExpired: async () => 0,
  };
  const app = Fastify();
  registerSsoRoutes(app, { oauthStates: store, currentUser: async () => ({ id: 'user-1', email: 'u@example.com', role: 'user', status: 'active' }) });

  const res = await app.inject({ method: 'GET', url: '/auth/login' });
  assert.equal(res.statusCode, 302);
  assert.equal(issued, true);
  const location = res.headers.location;
  assert.equal(typeof location, 'string');
  assert.match(String(location), /login\.eveonline\.com/);
  assert.match(String(location), /state=state-from-store/);
}));

test('EVE login requires an app user and stores their id in OAuth state metadata', withEveEnv(async () => {
  let issuedMetadata: Record<string, unknown> | undefined;
  const store = {
    issue: async (metadata?: Record<string, unknown>) => { issuedMetadata = metadata; return 'state-from-store'; },
    consume: async () => null,
    deleteExpired: async () => 0,
  } as any as OAuthStateStore;

  const unauthenticated = Fastify();
  registerSsoRoutes(unauthenticated, {
    oauthStates: store,
    currentUser: async () => null,
  } as any);

  const denied = await unauthenticated.inject({ method: 'GET', url: '/auth/login' });
  assert.equal(denied.statusCode, 401);
  assert.equal(issuedMetadata, undefined);

  const authenticated = Fastify();
  registerSsoRoutes(authenticated, {
    oauthStates: store,
    currentUser: async () => ({ id: 'user-1' }),
  } as any);

  const res = await authenticated.inject({ method: 'GET', url: '/auth/login' });
  assert.equal(res.statusCode, 302);
  assert.deepEqual(issuedMetadata, { userId: 'user-1' });
}));

test('EVE callback rejects invalid OAuth state before token exchange', withEveEnv(async () => {
  const store = {
    issue: async () => 'state-from-store',
    consume: async () => null,
    deleteExpired: async () => 0,
  } as any as OAuthStateStore;
  const app = Fastify();
  registerSsoRoutes(app, { oauthStates: store });

  const res = await app.inject({ method: 'GET', url: '/auth/callback?code=abc&state=bad' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body, 'Invalid state');
}));
