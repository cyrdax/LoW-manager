import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createAppTokenStore, type AppTokenStore } from './app-token-store.ts';
import { hashPassword as hashPasswordDefault, verifyPassword as verifyPasswordDefault } from './password.ts';
import { createSessionStore, type SessionStore } from './session-store.ts';
import { createUserStore, type AppUser, type UserStore } from './user-store.ts';

const SESSION_COOKIE = 'efd_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginSchema = signupSchema;
const verifyRequestSchema = z.object({ email: z.string().trim().email() });

export interface AuthMailer {
  sendEmailVerification(input: { to: string; verificationUrl: string }): Promise<void>;
}

export interface AppAuthRouteDeps {
  users?: UserStore;
  sessions?: SessionStore;
  appTokens?: AppTokenStore;
  mailer?: AuthMailer;
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
}

export function createDevAuthMailer(logger?: Pick<FastifyBaseLogger, 'info'>): AuthMailer {
  return {
    async sendEmailVerification(input) {
      logger?.info(`[auth] verification for ${input.to}: ${input.verificationUrl}`);
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

function readSessionToken(req: FastifyRequest, cookieName: string): string | null {
  const raw = req.cookies?.[cookieName];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? unsigned.value ?? null : null;
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
