import { createHash, randomBytes } from 'node:crypto';
import { getPostgresPool } from '../db/postgres.ts';
import type { QueryClient } from '../db/migrations.ts';

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;

export type AppTokenPurpose = 'email_verification' | 'password_reset' | 'google_oauth_state' | 'eve_oauth_state';

export interface IssueAppTokenInput {
  purpose: AppTokenPurpose;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  ttlMs?: number;
}

export interface ConsumedAppToken {
  id: string;
  userId: string | null;
  purpose: AppTokenPurpose;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface AppTokenStore {
  issue(input: IssueAppTokenInput): Promise<string>;
  consume(purpose: AppTokenPurpose, token: string): Promise<ConsumedAppToken | null>;
  deleteExpired(purpose?: AppTokenPurpose): Promise<number>;
}

export interface AppTokenStoreOptions {
  now?: () => Date;
  tokenFactory?: () => string;
}

interface AuthTokenRow {
  id: string;
  user_id: string | null;
  purpose: AppTokenPurpose;
  metadata: Record<string, unknown> | string;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

export function createAppTokenStore(
  client: QueryClient = getPostgresPool(),
  options: AppTokenStoreOptions = {},
): AppTokenStore {
  const now = options.now ?? (() => new Date());
  const tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));

  return {
    async issue(input) {
      const token = tokenFactory();
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + (input.ttlMs ?? DEFAULT_TOKEN_TTL_MS));
      await client.query(
        `
          INSERT INTO auth_tokens (user_id, purpose, token_hash, metadata, created_at, expires_at)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        `,
        [
          input.userId ?? null,
          input.purpose,
          hashAppToken(token),
          JSON.stringify(input.metadata ?? {}),
          issuedAt,
          expiresAt,
        ],
      );
      return token;
    },

    async consume(purpose, token) {
      const consumedAt = now();
      const rows = await client.query<AuthTokenRow>(
        `
          UPDATE auth_tokens
          SET consumed_at = $3
          WHERE purpose = $1
            AND token_hash = $2
            AND consumed_at IS NULL
            AND expires_at > $3
          RETURNING id, user_id, purpose, metadata, created_at, expires_at, consumed_at
        `,
        [purpose, hashAppToken(token), consumedAt],
      );
      return rows.rows[0] ? mapToken(rows.rows[0]) : null;
    },

    async deleteExpired(purpose) {
      const result = await client.query(
        `
          DELETE FROM auth_tokens
          WHERE expires_at <= $1
            AND ($2::auth_token_purpose IS NULL OR purpose = $2)
        `,
        [now(), purpose ?? null],
      );
      return result.rowCount ?? 0;
    },
  };
}

export function hashAppToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mapToken(row: AuthTokenRow): ConsumedAppToken {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    createdAt: dateValue(row.created_at),
    expiresAt: dateValue(row.expires_at),
    consumedAt: nullableDate(row.consumed_at),
  };
}

function nullableDate(value: Date | string | null): Date | null {
  return value == null ? null : dateValue(value);
}

function dateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
