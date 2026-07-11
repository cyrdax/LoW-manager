import { createHash, randomBytes } from 'node:crypto';
import { getPostgresPool } from '../db/postgres.ts';
import type { QueryClient } from '../db/migrations.ts';
import type { AppUser, UserRole, UserStatus } from './user-store.ts';

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface UserSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface IssuedSession {
  token: string;
  session: UserSession;
}

export interface AuthenticatedSession {
  session: UserSession;
  user: Pick<AppUser, 'id' | 'email' | 'role' | 'status'>;
}

export interface SessionStore {
  create(userId: string, metadata?: SessionMetadata): Promise<IssuedSession | null>;
  findByToken(token: string): Promise<AuthenticatedSession | null>;
  touch(sessionId: string): Promise<void>;
  revoke(token: string): Promise<void>;
  deleteExpired(): Promise<number>;
}

export interface SessionMetadata {
  ipHash?: string | null;
  userAgentHash?: string | null;
}

export interface SessionStoreOptions {
  ttlMs?: number;
  now?: () => Date;
  tokenFactory?: () => string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  last_seen_at: Date | string | null;
  ip_hash: string | null;
  user_agent_hash: string | null;
}

interface AuthenticatedSessionRow extends SessionRow {
  user_email: string | null;
  user_role: UserRole;
  user_status: UserStatus;
}

export function createSessionStore(
  client: QueryClient = getPostgresPool(),
  options: SessionStoreOptions = {},
): SessionStore {
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = options.now ?? (() => new Date());
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));

  return {
    async create(userId, metadata = {}) {
      const token = tokenFactory();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      const rows = await client.query<SessionRow>(
        `
          WITH active_user AS (
            SELECT id FROM app_users WHERE id = $1 AND status = 'active'
          )
          INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, ip_hash, user_agent_hash)
          SELECT id, $2, $3, $4, $5, $6 FROM active_user
          RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at,
            last_seen_at, ip_hash, user_agent_hash
        `,
        [
          userId,
          hashSessionToken(token),
          issuedAt,
          expiresAt,
          metadata.ipHash ?? null,
          metadata.userAgentHash ?? null,
        ],
      );
      const row = rows.rows[0];
      return row ? { token, session: mapSession(row) } : null;
    },

    async findByToken(token) {
      const rows = await client.query<AuthenticatedSessionRow>(
        `
          SELECT s.id, s.user_id, s.token_hash, s.created_at, s.expires_at, s.revoked_at,
            s.last_seen_at, s.ip_hash, s.user_agent_hash,
            u.email AS user_email, u.role AS user_role, u.status AS user_status
          FROM user_sessions s
          JOIN app_users u ON u.id = s.user_id
          WHERE s.token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > $2
            AND u.status = 'active'
        `,
        [hashSessionToken(token), now()],
      );
      const row = rows.rows[0];
      return row
        ? {
            session: mapSession(row),
            user: {
              id: row.user_id,
              email: row.user_email,
              role: row.user_role,
              status: row.user_status,
            },
          }
        : null;
    },

    async touch(sessionId) {
      await client.query(
        'UPDATE user_sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL',
        [sessionId, now()],
      );
    },

    async revoke(token) {
      await client.query(
        `
          UPDATE user_sessions
          SET revoked_at = $2
          WHERE token_hash = $1 AND revoked_at IS NULL
        `,
        [hashSessionToken(token), now()],
      );
    },

    async deleteExpired() {
      const result = await client.query('DELETE FROM user_sessions WHERE expires_at <= $1', [now()]);
      return result.rowCount ?? 0;
    },
  };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mapSession(row: SessionRow): UserSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: dateValue(row.created_at),
    expiresAt: dateValue(row.expires_at),
    revokedAt: nullableDate(row.revoked_at),
    lastSeenAt: nullableDate(row.last_seen_at),
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
  };
}

function nullableDate(value: Date | string | null): Date | null {
  return value == null ? null : dateValue(value);
}

function dateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
