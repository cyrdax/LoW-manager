import { getPostgresPool } from '../db/postgres.ts';
import { withTransaction, type TransactionSource } from '../db/transaction.ts';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'disabled' | 'deleted';

export interface AppUser {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: UserRole;
  status: UserStatus;
  mainCharacterId: number | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PasswordUser {
  user: AppUser;
  passwordHash: string;
}

export interface UserStore {
  createPasswordUser(email: string, passwordHash: string): Promise<AppUser>;
  findByEmailWithPassword(email: string): Promise<PasswordUser | null>;
  markEmailVerified(userId: string): Promise<AppUser | null>;
  markActive(userId: string): Promise<AppUser | null>;
  updatePassword(userId: string, passwordHash: string): Promise<boolean>;
}

export interface UserStoreOptions {
  now?: () => Date;
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

interface PasswordUserRow extends AppUserRow {
  password_hash: string;
}

export function createUserStore(
  source: TransactionSource = getPostgresPool(),
  options: UserStoreOptions = {},
): UserStore {
  const now = options.now ?? (() => new Date());

  return {
    async createPasswordUser(email, passwordHash) {
      const normalizedEmail = normalizeEmail(email);
      return withTransaction(source, async client => {
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
        const timestamp = now();
        const userRows = await client.query<AppUserRow>(
          `
            INSERT INTO app_users (email, role, created_at, updated_at)
            VALUES ($1, $2, $3, $3)
            RETURNING id, email, email_verified_at, role, status, main_character_id,
              last_active_at, created_at, updated_at, deleted_at
          `,
          [normalizedEmail, role, timestamp],
        );
        const row = userRows.rows[0];
        if (!row) throw new Error('Failed to create user');

        await client.query(
          `
            INSERT INTO user_password_credentials (user_id, email, password_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $4)
          `,
          [row.id, normalizedEmail, passwordHash, timestamp],
        );
        return mapUser(row);
      });
    },

    async findByEmailWithPassword(email) {
      const rows = await source.query<PasswordUserRow>(
        `
          SELECT u.id, u.email, u.email_verified_at, u.role, u.status, u.main_character_id,
            u.last_active_at, u.created_at, u.updated_at, u.deleted_at, c.password_hash
          FROM app_users u
          JOIN user_password_credentials c ON c.user_id = u.id
          WHERE c.email = $1
        `,
        [normalizeEmail(email)],
      );
      const row = rows.rows[0];
      return row ? { user: mapUser(row), passwordHash: row.password_hash } : null;
    },

    async markEmailVerified(userId) {
      const timestamp = now();
      const rows = await source.query<AppUserRow>(
        `
          UPDATE app_users
          SET email_verified_at = COALESCE(email_verified_at, $2),
            updated_at = $2
          WHERE id = $1
          RETURNING id, email, email_verified_at, role, status, main_character_id,
            last_active_at, created_at, updated_at, deleted_at
        `,
        [userId, timestamp],
      );
      return rows.rows[0] ? mapUser(rows.rows[0]) : null;
    },

    async markActive(userId) {
      const timestamp = now();
      const rows = await source.query<AppUserRow>(
        `
          UPDATE app_users
          SET last_active_at = $2, updated_at = $2
          WHERE id = $1 AND status = 'active'
          RETURNING id, email, email_verified_at, role, status, main_character_id,
            last_active_at, created_at, updated_at, deleted_at
        `,
        [userId, timestamp],
      );
      return rows.rows[0] ? mapUser(rows.rows[0]) : null;
    },

    async updatePassword(userId, passwordHash) {
      const result = await source.query<{ user_id: string }>(
        `
          UPDATE user_password_credentials c
          SET password_hash = $2, updated_at = $3
          FROM app_users u
          WHERE c.user_id = $1
            AND u.id = c.user_id
            AND u.status = 'active'
          RETURNING c.user_id
        `,
        [userId, passwordHash, now()],
      );
      return result.rows.length > 0;
    },
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mapUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: nullableDate(row.email_verified_at),
    role: row.role,
    status: row.status,
    mainCharacterId: row.main_character_id == null ? null : Number(row.main_character_id),
    lastActiveAt: nullableDate(row.last_active_at),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    deletedAt: nullableDate(row.deleted_at),
  };
}

function nullableDate(value: Date | string | null): Date | null {
  return value == null ? null : dateValue(value);
}

function dateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
