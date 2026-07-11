import { createHash, randomBytes } from 'node:crypto';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface OAuthStateStore {
  issue(metadata?: Record<string, unknown>): Promise<string>;
  consume(state: string): Promise<boolean>;
  deleteExpired(): Promise<number>;
}

export interface OAuthStateStoreOptions {
  ttlMs?: number;
  now?: () => Date;
}

export function createOAuthStateStore(
  client: QueryClient = getPostgresPool(),
  options: OAuthStateStoreOptions = {},
): OAuthStateStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => new Date());

  return {
    async issue(metadata: Record<string, unknown> = {}): Promise<string> {
      const state = randomBytes(16).toString('hex');
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      await client.query(
        `
          INSERT INTO auth_tokens (purpose, token_hash, metadata, created_at, expires_at)
          VALUES ('eve_oauth_state', $1, $2::jsonb, $3, $4)
        `,
        [hashState(state), JSON.stringify(metadata), issuedAt, expiresAt],
      );
      return state;
    },

    async consume(state: string): Promise<boolean> {
      const consumedAt = now();
      const result = await client.query(
        `
          UPDATE auth_tokens
          SET consumed_at = $2
          WHERE purpose = 'eve_oauth_state'
            AND token_hash = $1
            AND consumed_at IS NULL
            AND expires_at > $2
          RETURNING id
        `,
        [hashState(state), consumedAt],
      );
      return result.rowCount === 1;
    },

    async deleteExpired(): Promise<number> {
      const result = await client.query(
        `
          DELETE FROM auth_tokens
          WHERE purpose = 'eve_oauth_state'
            AND expires_at <= $1
        `,
        [now()],
      );
      return result.rowCount ?? 0;
    },
  };
}

export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}
