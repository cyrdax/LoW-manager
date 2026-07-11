import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { createAppTokenStore, type AppTokenStore } from './app-token-store.ts';
import { readSessionToken, SESSION_COOKIE } from './current-user.ts';
import { hashPassword as hashPasswordDefault, verifyPassword as verifyPasswordDefault } from './password.ts';
import { createSessionStore, type SessionStore } from './session-store.ts';
import { createUserStore, type AppUser, type UserStore } from './user-store.ts';

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginSchema = signupSchema;
const verifyRequestSchema = z.object({ email: z.string().trim().email() });
const resetCompleteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export interface AuthMailer {
  sendEmailVerification(input: { to: string; verificationUrl: string }): Promise<void>;
  sendPasswordReset(input: { to: string; resetUrl: string }): Promise<void>;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export interface GoogleTokenResult {
  idToken: string;
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  exchangeCode?: (code: string, input: { clientId: string; clientSecret: string; redirectUri: string; tokenUrl: string }) => Promise<GoogleTokenResult>;
  verifyIdToken?: (idToken: string, clientId: string) => Promise<GoogleIdentity>;
}

export interface AppAuthRouteDeps {
  users?: UserStore;
  sessions?: SessionStore;
  appTokens?: AppTokenStore;
  mailer?: AuthMailer;
  google?: GoogleAuthConfig | null;
  appBaseUrl?: string;
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (password: string, hash: string) => Promise<boolean>;
  sessionCookieName?: string;
  secureCookies?: boolean;
}

export function registerAppAuthRoutes(app: FastifyInstance, deps: AppAuthRouteDeps = {}) {
  const users = deps.users ?? createUserStore();
  const sessions = deps.sessions ?? createSessionStore();
  const appTokens = deps.appTokens ?? createAppTokenStore();
  const mailer = deps.mailer ?? createDevAuthMailer(app.log);
  const hashPassword = deps.hashPassword ?? hashPasswordDefault;
  const verifyPassword = deps.verifyPassword ?? verifyPasswordDefault;
  const cookieName = deps.sessionCookieName ?? SESSION_COOKIE;
  const appBaseUrl = deps.appBaseUrl ?? defaultAppBaseUrl();
  const secureCookies = deps.secureCookies ?? process.env.NODE_ENV === 'production';
  const google = deps.google === undefined ? googleConfigFromEnv() : deps.google;

  app.post('/api/auth/signup', async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await users.createPasswordUser(parsed.data.email, passwordHash);
      await sendVerification(user);
      return { user: publicUser(user), verificationSent: true };
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'email_already_registered' });
      throw err;
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const found = await users.findByEmailWithPassword(parsed.data.email);
    if (!found || !await verifyPassword(parsed.data.password, found.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    if (found.user.status !== 'active') return reply.code(403).send({ error: 'account_not_active' });
    if (!found.user.emailVerifiedAt) return reply.code(403).send({ error: 'email_not_verified' });

    const issued = await sessions.create(found.user.id, {
      ipHash: hashOptional(req.ip),
      userAgentHash: hashOptional(req.headers['user-agent']),
    });
    if (!issued) return reply.code(403).send({ error: 'account_not_active' });

    setSessionCookie(reply, cookieName, issued.token, secureCookies);
    await users.markActive(found.user.id);
    return { user: publicUser(found.user) };
  });

  app.get('/auth/google/start', async (_req, reply) => {
    const configured = normalizedGoogleConfig(google, appBaseUrl);
    if (!configured) return reply.code(503).send({ error: 'google_auth_not_configured' });
    const state = await appTokens.issue({
      purpose: 'google_oauth_state',
      metadata: { provider: 'google' },
      ttlMs: GOOGLE_OAUTH_STATE_TTL_MS,
    });
    const url = new URL(configured.authorizeUrl);
    url.searchParams.set('client_id', configured.clientId);
    url.searchParams.set('redirect_uri', configured.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/google/callback', async (req, reply) => {
    const configured = normalizedGoogleConfig(google, appBaseUrl);
    if (!configured) return reply.code(503).send({ error: 'google_auth_not_configured' });
    if (req.query.error) return reply.redirect(`/?auth_error=${encodeURIComponent(req.query.error)}`);
    if (!req.query.code || !req.query.state) return reply.code(400).send({ error: 'missing_google_oauth_code_or_state' });

    const consumed = await appTokens.consume('google_oauth_state', req.query.state);
    if (!consumed) return reply.code(400).send({ error: 'invalid_or_expired_google_state' });

    const tokens = await configured.exchangeCode(req.query.code, configured);
    const identity = await configured.verifyIdToken(tokens.idToken, configured.clientId);
    if (!identity.email || !identity.emailVerified) return reply.code(403).send({ error: 'google_email_not_verified' });

    const user = await users.findOrCreateGoogleUser({
      googleSub: identity.sub,
      email: identity.email,
      emailVerified: identity.emailVerified,
    });
    if (user.status !== 'active') return reply.code(403).send({ error: 'account_not_active' });

    const issued = await sessions.create(user.id, {
      ipHash: hashOptional(req.ip),
      userAgentHash: hashOptional(req.headers['user-agent']),
    });
    if (!issued) return reply.code(403).send({ error: 'account_not_active' });

    setSessionCookie(reply, cookieName, issued.token, secureCookies);
    await users.markActive(user.id);
    return reply.redirect('/');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readSessionToken(req, cookieName);
    if (token) await sessions.revoke(token);
    clearSessionCookie(reply, cookieName, secureCookies);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const token = readSessionToken(req, cookieName);
    if (!token) return { user: null };

    const found = await sessions.findByToken(token);
    if (!found) {
      clearSessionCookie(reply, cookieName, secureCookies);
      return { user: null };
    }

    await sessions.touch(found.session.id);
    await users.markActive(found.user.id);
    return { user: found.user };
  });

  app.post('/api/auth/email/verify/request', async (req, reply) => {
    const parsed = verifyRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const found = await users.findByEmailWithPassword(parsed.data.email);
    if (found?.user.email && !found.user.emailVerifiedAt && found.user.status === 'active') {
      await sendVerification(found.user);
    }
    return { ok: true };
  });

  app.post('/api/auth/password/reset/request', async (req, reply) => {
    const parsed = verifyRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const found = await users.findByEmailWithPassword(parsed.data.email);
    if (found?.user.email && found.user.emailVerifiedAt && found.user.status === 'active') {
      await sendPasswordReset(found.user);
    }
    return { ok: true };
  });

  app.post('/api/auth/password/reset/complete', async (req, reply) => {
    const parsed = resetCompleteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const consumed = await appTokens.consume('password_reset', parsed.data.token);
    if (!consumed?.userId) return reply.code(400).send({ error: 'invalid_or_expired_token' });

    const passwordHash = await hashPassword(parsed.data.password);
    if (!await users.updatePassword(consumed.userId, passwordHash)) {
      return reply.code(400).send({ error: 'invalid_or_expired_token' });
    }
    return { ok: true };
  });

  app.get<{ Querystring: { token?: string } }>('/auth/email/verify', async (req, reply) => {
    const token = req.query.token;
    if (!token) return reply.code(400).type('text/html').send(verificationPage('Missing verification token.'));

    const consumed = await appTokens.consume('email_verification', token);
    if (!consumed?.userId) {
      return reply.code(400).type('text/html').send(verificationPage('Verification link is invalid or expired.'));
    }

    await users.markEmailVerified(consumed.userId);
    return reply.type('text/html').send(verificationPage('Email verified. You can return to the app and log in.'));
  });

  async function sendVerification(user: AppUser): Promise<void> {
    if (!user.email) return;
    const token = await appTokens.issue({
      userId: user.id,
      purpose: 'email_verification',
      metadata: { email: user.email },
      ttlMs: EMAIL_VERIFICATION_TTL_MS,
    });
    const url = new URL('/auth/email/verify', appBaseUrl);
    url.searchParams.set('token', token);
    await mailer.sendEmailVerification({ to: user.email, verificationUrl: url.toString() });
  }

  async function sendPasswordReset(user: AppUser): Promise<void> {
    if (!user.email) return;
    const token = await appTokens.issue({
      userId: user.id,
      purpose: 'password_reset',
      metadata: { email: user.email },
      ttlMs: PASSWORD_RESET_TTL_MS,
    });
    const url = new URL('/auth/password/reset', appBaseUrl);
    url.searchParams.set('token', token);
    await mailer.sendPasswordReset({ to: user.email, resetUrl: url.toString() });
  }
}

function googleConfigFromEnv(): GoogleAuthConfig | null {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? process.env.GOOGLE_CALLBACK_URL,
  };
}

function normalizedGoogleConfig(config: GoogleAuthConfig | null | undefined, appBaseUrl: string) {
  if (!config?.clientId || !config.clientSecret) return null;
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri ?? new URL('/auth/google/callback', appBaseUrl).toString(),
    authorizeUrl: config.authorizeUrl ?? GOOGLE_AUTHORIZE_URL,
    tokenUrl: config.tokenUrl ?? GOOGLE_TOKEN_URL,
    exchangeCode: config.exchangeCode ?? exchangeGoogleCode,
    verifyIdToken: config.verifyIdToken ?? verifyGoogleIdToken,
  };
}

async function exchangeGoogleCode(
  code: string,
  input: { clientId: string; clientSecret: string; redirectUri: string; tokenUrl: string },
): Promise<GoogleTokenResult> {
  const res = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json().catch(() => ({})) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(body.error ?? 'failed_google_token_exchange');
  return { idToken: body.id_token };
}

async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  });
  if (typeof payload.sub !== 'string') throw new Error('google_token_missing_subject');
  if (typeof payload.email !== 'string') throw new Error('google_token_missing_email');
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}

export function createDevAuthMailer(logger?: Pick<FastifyBaseLogger, 'info'>): AuthMailer {
  return {
    async sendEmailVerification(input) {
      logger?.info(`[auth] verification for ${input.to}: ${input.verificationUrl}`);
    },
    async sendPasswordReset(input) {
      logger?.info(`[auth] password reset for ${input.to}: ${input.resetUrl}`);
    },
  };
}

function publicUser(user: AppUser) {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    role: user.role,
    status: user.status,
    mainCharacterId: user.mainCharacterId,
  };
}

function setSessionCookie(reply: FastifyReply, cookieName: string, token: string, secure: boolean): void {
  reply.setCookie(cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

function clearSessionCookie(reply: FastifyReply, cookieName: string, secure: boolean): void {
  reply.clearCookie(cookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
  });
}

function hashOptional(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const normalized = Array.isArray(value) ? value.join(',') : value;
  return createHash('sha256').update(normalized).digest('hex');
}

function defaultAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

function verificationPage(message: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem"><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
