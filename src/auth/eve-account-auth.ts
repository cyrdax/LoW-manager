import {
  CharacterOwnerMismatchError,
  CharacterOwnershipError,
  upsertPostgresAuthorizedCharacter,
  type AuthorizedCharacterInput,
} from '../characters/store.ts';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';
import { withTransaction, type TransactionSource } from '../db/transaction.ts';
import type { AppUser, UserRole, UserStatus } from './user-store.ts';

export type EveAccountAuthInput = Omit<AuthorizedCharacterInput, 'userId'>;

export interface EveAccountAuthResult {
  user: AppUser;
  created: boolean;
  backfilled: boolean;
}

export type EveAccountAuthErrorCode =
  | 'account_not_active'
  | 'eve_owner_mismatch'
  | 'character_linked_elsewhere';

export class EveAccountAuthError extends Error {
  constructor(readonly code: EveAccountAuthErrorCode) {
    super(code);
    this.name = 'EveAccountAuthError';
  }
}

export interface EveAccountAuthService {
  complete(input: EveAccountAuthInput): Promise<EveAccountAuthResult>;
}

export interface EveAccountAuthServiceOptions {
  now?: () => Date;
  secretKey?: Buffer;
}

interface AppUserRow {
  id: string;
  email: string | null;
  email_verified_at: Date | string | null;
  role: UserRole;
  status: UserStatus;
  main_character_id: string | number | null;
  last_active_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface EveIdentityUserRow extends AppUserRow {
  identity_owner_hash: string;
}

interface LegacyPilotUserRow extends AppUserRow {
  pilot_owner_hash: string;
}

export function createEveAccountAuthService(
  source: TransactionSource = getPostgresPool(),
  options: EveAccountAuthServiceOptions = {},
): EveAccountAuthService {
  const now = options.now ?? (() => new Date());

  return {
    complete(input) {
      return withTransaction(source, async client => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [input.characterId]);

        const identity = await findIdentityWithUser(client, input.characterId);
        if (identity) return completeExistingIdentity(client, identity, input, now(), options);

        const legacy = await findLegacyPilotWithUser(client, input.characterId);
        if (legacy) return backfillLegacyIdentity(client, legacy, input, now(), options);

        return createAccountIdentityAndPilot(client, input, now(), options);
      });
    },
  };
}

async function findIdentityWithUser(client: QueryClient, characterId: number): Promise<EveIdentityUserRow | null> {
  const rows = await client.query<EveIdentityUserRow>(
    `
      SELECT u.id, u.email, u.email_verified_at, u.role, u.status, u.main_character_id,
        u.last_active_at, u.created_at, u.updated_at, u.deleted_at,
        e.owner_hash AS identity_owner_hash
      FROM user_eve_accounts e
      JOIN app_users u ON u.id = e.user_id
      WHERE e.character_id = $1
      FOR UPDATE OF e, u
    `,
    [characterId],
  );
  return rows.rows[0] ?? null;
}

async function findLegacyPilotWithUser(client: QueryClient, characterId: number): Promise<LegacyPilotUserRow | null> {
  const rows = await client.query<LegacyPilotUserRow>(
    `
      SELECT u.id, u.email, u.email_verified_at, u.role, u.status, u.main_character_id,
        u.last_active_at, u.created_at, u.updated_at, u.deleted_at,
        c.owner_hash AS pilot_owner_hash
      FROM characters c
      JOIN app_users u ON u.id = c.user_id
      WHERE c.character_id = $1
      FOR UPDATE OF c, u
    `,
    [characterId],
  );
  return rows.rows[0] ?? null;
}

async function completeExistingIdentity(
  client: QueryClient,
  row: EveIdentityUserRow,
  input: EveAccountAuthInput,
  timestamp: Date,
  options: EveAccountAuthServiceOptions,
): Promise<EveAccountAuthResult> {
  requireActive(row);
  requireOwner(row.identity_owner_hash, input.ownerHash);
  await upsertPilot(client, row.id, input, timestamp, options);
  await client.query(
    'UPDATE user_eve_accounts SET last_login_at = $2 WHERE character_id = $1 RETURNING character_id',
    [input.characterId, timestamp],
  );
  const user = await setMainCharacterIfMissing(client, row.id, input.characterId, timestamp);
  return { user, created: false, backfilled: false };
}

async function backfillLegacyIdentity(
  client: QueryClient,
  row: LegacyPilotUserRow,
  input: EveAccountAuthInput,
  timestamp: Date,
  options: EveAccountAuthServiceOptions,
): Promise<EveAccountAuthResult> {
  requireActive(row);
  requireOwner(row.pilot_owner_hash, input.ownerHash);
  await insertIdentity(client, input.characterId, row.id, input.ownerHash, timestamp);
  await upsertPilot(client, row.id, input, timestamp, options);
  const user = await setMainCharacterIfMissing(client, row.id, input.characterId, timestamp);
  return { user, created: false, backfilled: true };
}

async function createAccountIdentityAndPilot(
  client: QueryClient,
  input: EveAccountAuthInput,
  timestamp: Date,
  options: EveAccountAuthServiceOptions,
): Promise<EveAccountAuthResult> {
  const roleRows = await client.query<{ role: UserRole }>(`
    SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM app_users WHERE role = 'admin' AND status <> 'deleted'
      )
      THEN 'user'::user_role
      ELSE 'admin'::user_role
    END AS role
  `);
  const role = roleRows.rows[0]?.role ?? 'user';
  const userRows = await client.query<AppUserRow>(
    `
      INSERT INTO app_users (email, role, created_at, updated_at)
      VALUES (NULL, $1, $2, $2)
      RETURNING id, email, email_verified_at, role, status, main_character_id,
        last_active_at, created_at, updated_at, deleted_at
    `,
    [role, timestamp],
  );
  const created = userRows.rows[0];
  if (!created) throw new Error('failed_to_create_eve_user');

  await insertIdentity(client, input.characterId, created.id, input.ownerHash, timestamp);
  await upsertPilot(client, created.id, input, timestamp, options);
  const user = await setMainCharacterIfMissing(client, created.id, input.characterId, timestamp);
  return { user, created: true, backfilled: false };
}

async function insertIdentity(
  client: QueryClient,
  characterId: number,
  userId: string,
  ownerHash: string,
  timestamp: Date,
): Promise<void> {
  await client.query(
    `
      INSERT INTO user_eve_accounts (character_id, user_id, owner_hash, linked_at, last_login_at)
      VALUES ($1, $2, $3, $4, $4)
      RETURNING character_id
    `,
    [characterId, userId, ownerHash, timestamp],
  );
}

async function upsertPilot(
  client: QueryClient,
  userId: string,
  input: EveAccountAuthInput,
  timestamp: Date,
  options: EveAccountAuthServiceOptions,
): Promise<void> {
  try {
    await upsertPostgresAuthorizedCharacter(client, { ...input, userId }, {
      now: () => timestamp,
      ...(options.secretKey ? { secretKey: options.secretKey } : {}),
    });
  } catch (error) {
    if (error instanceof CharacterOwnerMismatchError) throw new EveAccountAuthError('eve_owner_mismatch');
    if (error instanceof CharacterOwnershipError) throw new EveAccountAuthError('character_linked_elsewhere');
    throw error;
  }
}

async function setMainCharacterIfMissing(
  client: QueryClient,
  userId: string,
  characterId: number,
  timestamp: Date,
): Promise<AppUser> {
  const rows = await client.query<AppUserRow>(
    `
      UPDATE app_users
      SET main_character_id = COALESCE(main_character_id, $2),
        updated_at = $3
      WHERE id = $1 AND status = 'active'
      RETURNING id, email, email_verified_at, role, status, main_character_id,
        last_active_at, created_at, updated_at, deleted_at
    `,
    [userId, characterId, timestamp],
  );
  const row = rows.rows[0];
  if (!row) throw new EveAccountAuthError('account_not_active');
  return mapUser(row);
}

function requireActive(user: Pick<AppUserRow, 'status'>): void {
  if (user.status !== 'active') throw new EveAccountAuthError('account_not_active');
}

function requireOwner(expected: string, actual: string): void {
  if (expected !== actual) throw new EveAccountAuthError('eve_owner_mismatch');
}

function mapUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: dateOrNull(row.email_verified_at),
    role: row.role,
    status: row.status,
    mainCharacterId: row.main_character_id == null ? null : Number(row.main_character_id),
    lastActiveAt: dateOrNull(row.last_active_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: dateOrNull(row.deleted_at),
  };
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function dateOrNull(value: Date | string | null): Date | null {
  return value == null ? null : date(value);
}
