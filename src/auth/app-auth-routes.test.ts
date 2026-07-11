import assert from 'node:assert/strict';
import test from 'node:test';
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
  });
  return app;
}

function testDeps() {
  const users = new FakeUserStore();
  const sessions = new FakeSessionStore(users);
  const tokens = new FakeTokenStore();
  const mailer = new FakeMailer();
  return { users, sessions, tokens, mailer };
}

class FakeUserStore implements UserStore {
  users = new Map<string, AppUser>();
  credentials = new Map<string, string>();
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

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user || !user.email) return false;
    this.credentials.set(user.email, passwordHash);
    return true;
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
    return { session: entry.session, user: { id: user.id, email: user.email, role: user.role, status: user.status } };
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
    const raw = `${input.purpose === 'password_reset' ? 'reset' : 'verify'}-token-${this.nextId}`;
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
