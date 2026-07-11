import type { FastifyRequest } from 'fastify';
import { createSessionStore, type SessionStore } from './session-store.ts';
import type { AppUser } from './user-store.ts';

export const SESSION_COOKIE = 'efd_session';

export type CurrentAppUser = Pick<AppUser, 'id' | 'email' | 'role' | 'status'>;
export type CurrentUserResolver = (req: FastifyRequest) => Promise<CurrentAppUser | null>;

export interface CurrentUserResolverDeps {
  sessions?: SessionStore;
  sessionCookieName?: string;
}

export function createCurrentUserResolver(deps: CurrentUserResolverDeps = {}): CurrentUserResolver {
  const sessions = deps.sessions ?? createSessionStore();
  const cookieName = deps.sessionCookieName ?? SESSION_COOKIE;

  return async (req) => {
    const token = readSessionToken(req, cookieName);
    if (!token) return null;
    const found = await sessions.findByToken(token);
    return found?.user ?? null;
  };
}

export function readSessionToken(req: FastifyRequest, cookieName = SESSION_COOKIE): string | null {
  const raw = req.cookies?.[cookieName];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? unsigned.value ?? null : null;
}
