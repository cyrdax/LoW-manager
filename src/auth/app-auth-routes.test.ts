import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAppAuthRoutes, type AuthMailer } from './app-auth-routes.ts';
import type { AppTokenStore, AppTokenPurpose, ConsumedAppToken, IssueAppTokenInput } from './app-token-store.ts';
import type { IssuedSession, SessionMetadata, SessionStore, UserSession } from './session-store.ts';
import type { AppUser, PasswordUser, UserStore } from './user-store.ts';

test('signup creates a password user and sends an email verification link', async () => {
  const deps = testDeps();
  const app = await appWithAuth(deps);

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: ' Pilot@Example.COM ', password: 'correct horse battery staple' },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as { user: { email: string; role: string; emailVerifiedAt: string | null } };
  assert.equal(body.user.email, 'pilot@example.com');
  assert.equal(body.user.role, 'admin');
  assert.equal(body.user.emailVerifiedAt, null);
  assert.equal(deps.mailer.sent.length, 1);
  assert.equal(deps.mailer.sent[0].to, 'pilot@example.com');
  assert.match(deps.mailer.sent[0].verificationUrl, /^http:\/\/test\.local\/auth\/email\/verify\?token=verify-token-1$/);

  await app.close();
});

test('login requires verified email and creates a readable session cookie', async () => {
  const deps = testDeps();
  const app = await appWithAuth(deps);

  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'pilot@example.com', password: 'password-12345' },
  });

  const blocked = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'pilot@example.com', password: 'password-12345' },
  });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error, 'email_not_verified');

  const verify = await app.inject('/auth/email/verify?token=verify-token-1');
  assert.equal(verify.statusCode, 200);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'pilot@example.com', password: 'password-12345' },
  });
  assert.equal(login.statusCode, 200);
  const cookieHeader = login.headers['set-cookie'];
  assert.ok(cookieHeader);
  const sessionCookie = Array.isArray(cookieHeader) ? cookieHeader[0].split(';')[0] : cookieHeader.split(';')[0];

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.email, 'pilot@example.com');

  await app.close();
});

test('logout revokes the current session and clears the cookie', async () => {
  const deps = testDeps();
  const app = await appWithAuth(deps);

  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'pilot@example.com', password: 'password-12345' },
  });
  await app.inject('/auth/email/verify?token=verify-token-1');
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'pilot@example.com', password: 'password-12345' },
  });
  const cookieHeader = login.headers['set-cookie'];
  assert.ok(cookieHeader);
  const sessionCookie = Array.isArray(cookieHeader) ? cookieHeader[0].split(';')[0] : cookieHeader.split(';')[0];

  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie } });
  assert.equal(logout.statusCode, 200);
  assert.equal(deps.sessions.revokedTokens[0], 'session-token-1');

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user, null);

  await app.close();
});

test('password reset request sends a token and complete updates login credentials', async () => {
  const deps = testDeps();
  const app = await appWithAuth(deps);

  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'pilot@example.com', password: 'old-password' },
  });
  await app.inject('/auth/email/verify?token=verify-token-1');

  const request = await app.inject({
    method: 'POST',
    url: '/api/auth/password/reset/request',
    payload: { email: 'pilot@example.com' },
  });
  assert.equal(request.statusCode, 200);
  assert.equal(deps.mailer.resets.length, 1);
  assert.match(deps.mailer.resets[0].resetUrl, /^http:\/\/test\.local\/auth\/password\/reset\?token=reset-token-2$/);

  const complete = await app.inject({
    method: 'POST',
    url: '/api/auth/password/reset/complete',
    payload: { token: 'reset-token-2', password: 'new-password' },
  });
  assert.equal(complete.statusCode, 200);

  const oldLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'pilot@example.com', password: 'old-password' },
  });
  assert.equal(oldLogin.statusCode, 401);

  const newLogin = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'pilot@example.com', password: 'new-password' },
  });
  assert.equal(newLogin.statusCode, 200);

  await app.close();
});

test('password reset request does not reveal whether an email exists', async () => {
  const deps = testDeps();
  const app = await appWithAuth(deps);

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/reset/request',
    payload: { email: 'missing@example.com' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(deps.mailer.resets.length, 0);

  await app.close();
});

test('default auth mailer sends verification emails through Resend when configured', async (t) => {
  const deps = testDeps();
  const sent = stubResendFetch(t);
  withEmailEnv(t, {
    EMAIL_MODE: 'resend',
    RESEND_API_KEY: 'test-resend-key',
    EMAIL_FROM: 'LoW Manager <noreply@outfit420-2.com>',
  });
  const app = await appWithDefaultMailer(deps);

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'pilot@example.com', password: 'correct horse battery staple' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].authorization, 'Bearer test-resend-key');
  assert.deepEqual(sent[0].body.to, ['pilot@example.com']);
  assert.equal(sent[0].body.from, 'LoW Manager <noreply@outfit420-2.com>');
  assert.equal(sent[0].body.subject, 'Verify your LoW Manager email');
  assert.match(sent[0].body.html, /http:\/\/test\.local\/auth\/email\/verify\?token=verify-token-1/);
  assert.match(sent[0].body.text, /http:\/\/test\.local\/auth\/email\/verify\?token=verify-token-1/);

  await app.close();
});

test('default auth mailer sends password reset emails through Resend when configured', async (t) => {
  const deps = testDeps();
  const sent = stubResendFetch(t);
  withEmailEnv(t, {
    EMAIL_MODE: 'resend',
    RESEND_API_KEY: 'test-resend-key',
    EMAIL_FROM: 'LoW Manager <noreply@outfit420-2.com>',
  });
  const app = await appWithDefaultMailer(deps);

  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: 'pilot@example.com', password: 'old-password' },
  });
  await app.inject('/auth/email/verify?token=verify-token-1');
  const request = await app.inject({
    method: 'POST',
    url: '/api/auth/password/reset/request',
    payload: { email: 'pilot@example.com' },
  });

  assert.equal(request.statusCode, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.subject, 'Reset your LoW Manager password');
  assert.deepEqual(sent[1].body.to, ['pilot@example.com']);
  assert.match(sent[1].body.html, /http:\/\/test\.local\/auth\/password\/reset\?token=reset-token-2/);
  assert.match(sent[1].body.text, /http:\/\/test\.local\/auth\/password\/reset\?token=reset-token-2/);

  await app.close();
});

test('google auth start redirects to Google with an oauth state token', async () => {
  const deps = testDeps();
  deps.google = testGoogleConfig();
  const app = await appWithAuth(deps);

  const res = await app.inject({ method: 'GET', url: '/auth/google/start' });

  assert.equal(res.statusCode, 302);
  const location = String(res.headers.location);
  assert.match(location, /^https:\/\/accounts\.google\.test\/o\/oauth2\/v2\/auth\?/);
  assert.match(location, /client_id=google-client/);
  assert.match(location, /redirect_uri=http%3A%2F%2Ftest\.local%2Fauth%2Fgoogle%2Fcallback/);
  assert.match(location, /scope=openid\+email\+profile/);
  assert.match(location, /state=google-token-1/);

  await app.close();
});

test('google auth env accepts GOOGLE_CALLBACK_URL as redirect override', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };
  t.after(() => {
    restoreEnv('GOOGLE_CLIENT_ID', previous.GOOGLE_CLIENT_ID);
    restoreEnv('GOOGLE_CLIENT_SECRET', previous.GOOGLE_CLIENT_SECRET);
    restoreEnv('GOOGLE_CALLBACK_URL', previous.GOOGLE_CALLBACK_URL);
    restoreEnv('GOOGLE_REDIRECT_URI', previous.GOOGLE_REDIRECT_URI);
  });
  process.env.GOOGLE_CLIENT_ID = 'env-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'env-google-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3100/auth/google/callback';
  delete process.env.GOOGLE_REDIRECT_URI;

  const app = await appWithAuth(testDeps());
  const res = await app.inject({ method: 'GET', url: '/auth/google/start' });

  assert.equal(res.statusCode, 302);
  const location = String(res.headers.location);
  assert.match(location, /client_id=env-google-client/);
  assert.match(location, /redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fauth%2Fgoogle%2Fcallback/);

  await app.close();
});

test('google auth callback creates a session for a verified Google account', async () => {
  const deps = testDeps();
  deps.google = testGoogleConfig();
  const app = await appWithAuth(deps);

  await app.inject({ method: 'GET', url: '/auth/google/start' });
  const callback = await app.inject({ method: 'GET', url: '/auth/google/callback?state=google-token-1&code=oauth-code' });

  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, '/');
  assert.deepEqual(deps.google.exchangedCodes, ['oauth-code']);
  assert.deepEqual(deps.google.verifiedTokens, ['google-id-token']);
  const cookieHeader = callback.headers['set-cookie'];
  assert.ok(cookieHeader);
  const sessionCookie = Array.isArray(cookieHeader) ? cookieHeader[0].split(';')[0] : cookieHeader.split(';')[0];

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionCookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.email, 'google-pilot@example.com');

  await app.close();
});

async function appWithAuth(deps: ReturnType<typeof testDeps>) {
  const app = Fastify();
  await app.register(cookie, { secret: 'test-secret' });
  registerAppAuthRoutes(app, {
    users: deps.users,
    sessions: deps.sessions,
    appTokens: deps.tokens,
    mailer: deps.mailer,
    appBaseUrl: 'http://test.local',
    hashPassword: async password => `hashed:${password}`,
    verifyPassword: async (password, hash) => hash === `hashed:${password}`,
    ...(deps.google ? { google: deps.google } : {}),
  } as Parameters<typeof registerAppAuthRoutes>[1]);
  return app;
}

async function appWithDefaultMailer(deps: ReturnType<typeof testDeps>) {
  const app = Fastify();
  await app.register(cookie, { secret: 'test-secret' });
  registerAppAuthRoutes(app, {
    users: deps.users,
    sessions: deps.sessions,
    appTokens: deps.tokens,
    appBaseUrl: 'http://test.local',
    hashPassword: async password => `hashed:${password}`,
    verifyPassword: async (password, hash) => hash === `hashed:${password}`,
  });
  return app;
}

function testDeps() {
  const users = new FakeUserStore();
  const sessions = new FakeSessionStore(users);
  const tokens = new FakeTokenStore();
  const mailer = new FakeMailer();
  return { users, sessions, tokens, mailer, google: undefined as ReturnType<typeof testGoogleConfig> | undefined };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function withEmailEnv(t: TestContext, values: Record<string, string>) {
  const previous = {
    EMAIL_MODE: process.env.EMAIL_MODE,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    NODE_ENV: process.env.NODE_ENV,
  };
  t.after(() => {
    restoreEnv('EMAIL_MODE', previous.EMAIL_MODE);
    restoreEnv('RESEND_API_KEY', previous.RESEND_API_KEY);
    restoreEnv('EMAIL_FROM', previous.EMAIL_FROM);
    restoreEnv('NODE_ENV', previous.NODE_ENV);
  });
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function stubResendFetch(t: TestContext) {
  const previous = globalThis.fetch;
  const sent: Array<{
    url: string;
    authorization: string | null;
    body: { from: string; to: string[]; subject: string; html: string; text: string };
  }> = [];
  t.after(() => {
    globalThis.fetch = previous;
  });
  globalThis.fetch = (async (url, init) => {
    sent.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response(JSON.stringify({ id: `email-${sent.length}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return sent;
}

function testGoogleConfig() {
  const exchangedCodes: string[] = [];
  const verifiedTokens: string[] = [];
  return {
    clientId: 'google-client',
    clientSecret: 'google-secret',
    authorizeUrl: 'https://accounts.google.test/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.google.test/token',
    exchangedCodes,
    verifiedTokens,
    exchangeCode: async (code: string) => {
      exchangedCodes.push(code);
      return { idToken: 'google-id-token' };
    },
    verifyIdToken: async (idToken: string) => {
      verifiedTokens.push(idToken);
      return { sub: 'google-sub-1', email: 'google-pilot@example.com', emailVerified: true };
    },
  };
}

class FakeUserStore implements UserStore {
  users = new Map<string, AppUser>();
  credentials = new Map<string, string>();
  googleAccounts = new Map<string, string>();
  nextId = 1;

  async createPasswordUser(email: string, passwordHash: string): Promise<AppUser> {
    const normalized = email.trim().toLowerCase();
    const now = new Date('2026-07-11T12:00:00Z');
    const user: AppUser = {
      id: `user-${this.nextId++}`,
      email: normalized,
      emailVerifiedAt: null,
      role: this.users.size === 0 ? 'admin' : 'user',
      status: 'active',
      mainCharacterId: null,
      lastActiveAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.users.set(user.id, user);
    this.credentials.set(normalized, passwordHash);
    return user;
  }

  async findByEmailWithPassword(email: string): Promise<PasswordUser | null> {
    const normalized = email.trim().toLowerCase();
    const user = Array.from(this.users.values()).find(candidate => candidate.email === normalized);
    const passwordHash = this.credentials.get(normalized);
    return user && passwordHash ? { user, passwordHash } : null;
  }

  async markEmailVerified(userId: string): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    user.emailVerifiedAt = new Date('2026-07-11T12:05:00Z');
    return user;
  }

  async markActive(userId: string): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user || user.status !== 'active') return null;
    user.lastActiveAt = new Date('2026-07-11T12:10:00Z');
    return user;
  }

  async setMainCharacter(userId: string, characterId: number | null): Promise<AppUser | null> {
    const user = this.users.get(userId);
    if (!user || user.status !== 'active') return null;
    user.mainCharacterId = characterId;
    return user;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user || !user.email) return false;
    this.credentials.set(user.email, passwordHash);
    return true;
  }

  async findOrCreateGoogleUser(input: { googleSub: string; email: string; emailVerified: boolean }): Promise<AppUser> {
    const existingUserId = this.googleAccounts.get(input.googleSub);
    if (existingUserId) return this.users.get(existingUserId)!;
    const now = new Date('2026-07-11T12:00:00Z');
    const existingByEmail = Array.from(this.users.values()).find(user => user.email === input.email);
    const user = existingByEmail ?? {
      id: `user-${this.nextId++}`,
      email: input.email,
      emailVerifiedAt: input.emailVerified ? now : null,
      role: this.users.size === 0 ? 'admin' as const : 'user' as const,
      status: 'active' as const,
      mainCharacterId: null,
      lastActiveAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    if (!existingByEmail) this.users.set(user.id, user);
    this.googleAccounts.set(input.googleSub, user.id);
    return user;
  }
}

class FakeSessionStore implements SessionStore {
  sessions = new Map<string, { session: UserSession; userId: string }>();
  revokedTokens: string[] = [];
  nextId = 1;

  constructor(private users: FakeUserStore) {}

  async create(userId: string, metadata?: SessionMetadata): Promise<IssuedSession | null> {
    const user = this.users.users.get(userId);
    if (!user || user.status !== 'active') return null;
    const token = `session-token-${this.nextId}`;
    const session: UserSession = {
      id: `session-${this.nextId++}`,
      userId,
      tokenHash: `hashed:${token}`,
      createdAt: new Date('2026-07-11T12:00:00Z'),
      expiresAt: new Date('2026-08-10T12:00:00Z'),
      revokedAt: null,
      lastSeenAt: null,
      ipHash: metadata?.ipHash ?? null,
      userAgentHash: metadata?.userAgentHash ?? null,
    };
    this.sessions.set(token, { session, userId });
    return { token, session };
  }

  async findByToken(token: string) {
    if (this.revokedTokens.includes(token)) return null;
    const entry = this.sessions.get(token);
    if (!entry) return null;
    const user = this.users.users.get(entry.userId);
    if (!user || user.status !== 'active') return null;
    return {
      session: entry.session,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        mainCharacterId: user.mainCharacterId,
      },
    };
  }

  async touch(sessionId: string): Promise<void> {
    for (const entry of this.sessions.values()) {
      if (entry.session.id === sessionId) entry.session.lastSeenAt = new Date('2026-07-11T12:15:00Z');
    }
  }

  async revoke(token: string): Promise<void> {
    this.revokedTokens.push(token);
  }

  async deleteExpired(): Promise<number> {
    return 0;
  }
}

class FakeTokenStore implements AppTokenStore {
  tokens = new Map<string, ConsumedAppToken>();
  nextId = 1;

  async issue(input: IssueAppTokenInput): Promise<string> {
    const prefix = input.purpose === 'password_reset'
      ? 'reset'
      : input.purpose === 'google_oauth_state'
        ? 'google'
        : 'verify';
    const raw = `${prefix}-token-${this.nextId}`;
    this.tokens.set(raw, {
      id: `token-${this.nextId++}`,
      userId: input.userId ?? null,
      purpose: input.purpose,
      metadata: input.metadata ?? {},
      createdAt: new Date('2026-07-11T12:00:00Z'),
      expiresAt: new Date('2026-07-11T12:10:00Z'),
      consumedAt: null,
    });
    return raw;
  }

  async consume(purpose: AppTokenPurpose, token: string): Promise<ConsumedAppToken | null> {
    const record = this.tokens.get(token);
    if (!record || record.purpose !== purpose || record.consumedAt) return null;
    record.consumedAt = new Date('2026-07-11T12:05:00Z');
    return record;
  }

  async deleteExpired(): Promise<number> {
    return 0;
  }
}

class FakeMailer implements AuthMailer {
  sent: Array<{ to: string; verificationUrl: string }> = [];
  resets: Array<{ to: string; resetUrl: string }> = [];

  async sendEmailVerification(input: { to: string; verificationUrl: string }): Promise<void> {
    this.sent.push(input);
  }

  async sendPasswordReset(input: { to: string; resetUrl: string }): Promise<void> {
    this.resets.push(input);
  }
}
