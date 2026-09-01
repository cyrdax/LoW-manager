import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from './current-user.ts';
import type { SessionMetadata } from './session-store.ts';

export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface SessionCookieOptions {
  cookieName?: string;
  secure?: boolean;
}

export function safeLocalReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';

  try {
    const base = 'https://outfit.local';
    const url = new URL(trimmed, base);
    if (url.origin !== base || url.pathname.startsWith('/auth/')) return '/';
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return '/';
  }
}

export function sessionMetadataForRequest(req: FastifyRequest): SessionMetadata {
  return {
    ipHash: hashOptional(req.ip),
    userAgentHash: hashOptional(req.headers['user-agent']),
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: SessionCookieOptions = {},
): void {
  reply.setCookie(options.cookieName ?? SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure ?? process.env.NODE_ENV === 'production',
    signed: true,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply, options: SessionCookieOptions = {}): void {
  reply.clearCookie(options.cookieName ?? SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure ?? process.env.NODE_ENV === 'production',
  });
}

function hashOptional(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  return createHash('sha256').update(Array.isArray(value) ? value.join(',') : value).digest('hex');
}
