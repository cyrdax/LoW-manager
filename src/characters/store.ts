import type Database from 'better-sqlite3';
import { decryptSecret, encryptSecret, tokenEncryptionKey, type EncryptedSecret } from '../auth/secret-box.ts';
import { db as defaultDb } from '../db.ts';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';
import { withTransaction } from '../db/transaction.ts';
import type { CharacterRow } from '../types.ts';

type SqliteDatabase = Database.Database;

export interface AuthorizedCharacterInput {
  characterId: number;
  userId: string;
  characterName: string;
  ownerHash: string;
  scopes: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
}

export interface UpdateCharacterTokensInput {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
}

export interface CharacterStore {
  listAll(): CharacterRow[];
  listByUser(userId: string): CharacterRow[];
  listUsableByUser(userId: string): CharacterRow[];
  listIdsByUser(userId: string): number[];
  getById(characterId: number): CharacterRow | undefined;
  getOwned(userId: string, characterId: number): CharacterRow | undefined;
  owns(userId: string, characterId: number): boolean;
  upsertAuthorized(input: AuthorizedCharacterInput): CharacterRow;
  updateTokens(characterId: number, input: UpdateCharacterTokensInput): CharacterRow | undefined;
  markNeedsReauth(characterId: number): boolean;
  setBoss(userId: string, characterId: number): CharacterRow[];
  deleteOwned(userId: string, characterId: number): boolean;
}

export interface AsyncCharacterStore {
  listAll(): Promise<CharacterRow[]>;
  listByUser(userId: string): Promise<CharacterRow[]>;
  listUsableByUser(userId: string): Promise<CharacterRow[]>;
  listIdsByUser(userId: string): Promise<number[]>;
  getById(characterId: number): Promise<CharacterRow | undefined>;
  getOwned(userId: string, characterId: number): Promise<CharacterRow | undefined>;
  owns(userId: string, characterId: number): Promise<boolean>;
  upsertAuthorized(input: AuthorizedCharacterInput): Promise<CharacterRow>;
  updateTokens(characterId: number, input: UpdateCharacterTokensInput): Promise<CharacterRow | undefined>;
  markNeedsReauth(characterId: number): Promise<boolean>;
  setBoss(userId: string, characterId: number): Promise<CharacterRow[]>;
  deleteOwned(userId: string, characterId: number): Promise<boolean>;
}

export interface CharacterStoreOptions {
  now?: () => number;
}

export interface PostgresCharacterStoreOptions {
  now?: () => Date;
  secretKey?: Buffer;
}

interface PostgresCharacterRow {
  character_id: string | number;
  user_id: string;
  character_name: string;
  owner_hash: string;
  scopes: string;
  refresh_token_enc: EncryptedSecret;
  access_token_enc: EncryptedSecret | null;
  access_token_expires_at: Date | string | null;
  added_at: Date | string;
  needs_reauth: boolean;
  is_boss: boolean;
}

export function migrateCharactersDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      character_id            INTEGER PRIMARY KEY,
      user_id                 TEXT,
      character_name          TEXT NOT NULL,
      owner_hash              TEXT NOT NULL,
      scopes                  TEXT NOT NULL,
      refresh_token           TEXT NOT NULL,
      access_token            TEXT,
      access_token_expires_at INTEGER,
      added_at                INTEGER NOT NULL,
      needs_reauth            INTEGER NOT NULL DEFAULT 0,
      is_boss                 INTEGER NOT NULL DEFAULT 0
    );
  `);

  const characterColumns = database.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>;
  if (!characterColumns.some(c => c.name === 'user_id')) {
    database.prepare('ALTER TABLE characters ADD COLUMN user_id TEXT').run();
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);');
}

export function createSqliteCharacterStore(
  database: SqliteDatabase = defaultDb,
  options: CharacterStoreOptions = {},
): CharacterStore {
  const now = options.now ?? (() => Date.now());

  return {
    listAll() {
      return database.prepare('SELECT * FROM characters ORDER BY added_at').all() as CharacterRow[];
    },

    listByUser(userId) {
      return database.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY added_at').all(userId) as CharacterRow[];
    },

    listUsableByUser(userId) {
      return database.prepare('SELECT * FROM characters WHERE user_id = ? AND needs_reauth = 0 ORDER BY added_at')
        .all(userId) as CharacterRow[];
    },

    listIdsByUser(userId) {
      const rows = database.prepare('SELECT character_id FROM characters WHERE user_id = ? ORDER BY added_at')
        .all(userId) as Array<{ character_id: number }>;
      return rows.map(row => row.character_id);
    },

    getById(characterId) {
      return database.prepare('SELECT * FROM characters WHERE character_id = ?')
        .get(characterId) as CharacterRow | undefined;
    },

    getOwned(userId, characterId) {
      return database.prepare('SELECT * FROM characters WHERE character_id = ? AND user_id = ?')
        .get(characterId, userId) as CharacterRow | undefined;
    },

    owns(userId, characterId) {
      return !!database.prepare('SELECT 1 FROM characters WHERE character_id = ? AND user_id = ?')
        .get(characterId, userId);
    },

    upsertAuthorized(input) {
      const addedAt = now();
      database.prepare(`
        INSERT INTO characters (character_id, user_id, character_name, owner_hash, scopes,
          refresh_token, access_token, access_token_expires_at, added_at, needs_reauth, is_boss)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        ON CONFLICT(character_id) DO UPDATE SET
          user_id = excluded.user_id,
          character_name = excluded.character_name,
          owner_hash = excluded.owner_hash,
          scopes = excluded.scopes,
          refresh_token = excluded.refresh_token,
          access_token = excluded.access_token,
          access_token_expires_at = excluded.access_token_expires_at,
          needs_reauth = 0
      `).run(
        input.characterId,
        input.userId,
        input.characterName,
        input.ownerHash,
        input.scopes,
        input.refreshToken,
        input.accessToken,
        input.accessTokenExpiresAt,
        addedAt,
      );
      return this.getById(input.characterId)!;
    },

    updateTokens(characterId, input) {
      const result = database.prepare(`
        UPDATE characters
        SET refresh_token = ?, access_token = ?, access_token_expires_at = ?, needs_reauth = 0
        WHERE character_id = ?
      `).run(input.refreshToken, input.accessToken, input.accessTokenExpiresAt, characterId);
      return result.changes > 0 ? this.getById(characterId) : undefined;
    },

    markNeedsReauth(characterId) {
      const result = database.prepare('UPDATE characters SET needs_reauth = 1 WHERE character_id = ?').run(characterId);
      return result.changes > 0;
    },

    setBoss(userId, characterId) {
      const tx = database.transaction((id: number, ownerId: string) => {
        database.prepare('UPDATE characters SET is_boss = 0 WHERE user_id = ?').run(ownerId);
        database.prepare('UPDATE characters SET is_boss = 1 WHERE character_id = ? AND user_id = ?').run(id, ownerId);
      });
      tx(characterId, userId);
      return this.listByUser(userId);
    },

    deleteOwned(userId, characterId) {
      const result = database.prepare('DELETE FROM characters WHERE character_id = ? AND user_id = ?').run(characterId, userId);
      return result.changes > 0;
    },
  };
}

export function createPostgresCharacterStore(
  client: QueryClient = getPostgresPool(),
  options: PostgresCharacterStoreOptions = {},
): AsyncCharacterStore {
  const now = options.now ?? (() => new Date());
  const key = options.secretKey ?? tokenEncryptionKey();

  const store: AsyncCharacterStore = {
    async listAll() {
      const rows = await client.query<PostgresCharacterRow>(`
        SELECT character_id, user_id, character_name, owner_hash, scopes,
          refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
          needs_reauth, is_boss
        FROM characters
        ORDER BY added_at
      `);
      return rows.rows.map(row => mapPostgresCharacter(row, key));
    },

    async listByUser(userId) {
      const rows = await client.query<PostgresCharacterRow>(
        `
          SELECT character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
            needs_reauth, is_boss
          FROM characters
          WHERE user_id = $1
          ORDER BY added_at
        `,
        [userId],
      );
      return rows.rows.map(row => mapPostgresCharacter(row, key));
    },

    async listUsableByUser(userId) {
      const rows = await client.query<PostgresCharacterRow>(
        `
          SELECT character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
            needs_reauth, is_boss
          FROM characters
          WHERE user_id = $1 AND needs_reauth = false
          ORDER BY added_at
        `,
        [userId],
      );
      return rows.rows.map(row => mapPostgresCharacter(row, key));
    },

    async listIdsByUser(userId) {
      const rows = await client.query<{ character_id: string | number }>(
        `
          SELECT character_id FROM characters
          WHERE user_id = $1
          ORDER BY added_at
        `,
        [userId],
      );
      return rows.rows.map(row => Number(row.character_id));
    },

    async getById(characterId) {
      const rows = await client.query<PostgresCharacterRow>(
        `
          SELECT character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
            needs_reauth, is_boss
          FROM characters
          WHERE character_id = $1
        `,
        [characterId],
      );
      return rows.rows[0] ? mapPostgresCharacter(rows.rows[0], key) : undefined;
    },

    async getOwned(userId, characterId) {
      const rows = await client.query<PostgresCharacterRow>(
        `
          SELECT character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
            needs_reauth, is_boss
          FROM characters
          WHERE character_id = $1 AND user_id = $2
        `,
        [characterId, userId],
      );
      return rows.rows[0] ? mapPostgresCharacter(rows.rows[0], key) : undefined;
    },

    async owns(userId, characterId) {
      const rows = await client.query<{ ok: number }>(
        'SELECT 1 AS ok FROM characters WHERE character_id = $1 AND user_id = $2',
        [characterId, userId],
      );
      return rows.rows.length > 0;
    },

    async upsertAuthorized(input) {
      const addedAt = now();
      const rows = await client.query<PostgresCharacterRow>(
        `
          INSERT INTO characters (
            character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at,
            added_at, needs_reauth, is_boss, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, false, $9)
          ON CONFLICT (character_id) DO UPDATE SET
            user_id = excluded.user_id,
            character_name = excluded.character_name,
            owner_hash = excluded.owner_hash,
            scopes = excluded.scopes,
            refresh_token_enc = excluded.refresh_token_enc,
            access_token_enc = excluded.access_token_enc,
            access_token_expires_at = excluded.access_token_expires_at,
            needs_reauth = false,
            updated_at = excluded.updated_at
          RETURNING character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
            needs_reauth, is_boss
        `,
        [
          input.characterId,
          input.userId,
          input.characterName,
          input.ownerHash,
          input.scopes,
          encryptSecret(input.refreshToken, key),
          input.accessToken ? encryptSecret(input.accessToken, key) : null,
          input.accessTokenExpiresAt == null ? null : new Date(input.accessTokenExpiresAt),
          addedAt,
        ],
      );
      return mapPostgresCharacter(rows.rows[0]!, key);
    },

    async updateTokens(characterId, input) {
      const rows = await client.query<PostgresCharacterRow>(
        `
          UPDATE characters
          SET refresh_token_enc = $1,
            access_token_enc = $2,
            access_token_expires_at = $3,
            needs_reauth = false,
            updated_at = now()
          WHERE character_id = $4
          RETURNING character_id, user_id, character_name, owner_hash, scopes,
            refresh_token_enc, access_token_enc, access_token_expires_at, added_at,
            needs_reauth, is_boss
        `,
        [
          encryptSecret(input.refreshToken, key),
          encryptSecret(input.accessToken, key),
          new Date(input.accessTokenExpiresAt),
          characterId,
        ],
      );
      return rows.rows[0] ? mapPostgresCharacter(rows.rows[0], key) : undefined;
    },

    async markNeedsReauth(characterId) {
      const result = await client.query<{ character_id: string | number }>(
        `
          UPDATE characters
          SET needs_reauth = true, updated_at = now()
          WHERE character_id = $1
          RETURNING character_id
        `,
        [characterId],
      );
      return result.rows.length > 0;
    },

    async setBoss(userId, characterId) {
      await withTransaction(client, async tx => {
        await tx.query('UPDATE characters SET is_boss = false, updated_at = now() WHERE user_id = $1', [userId]);
        await tx.query(
          'UPDATE characters SET is_boss = true, updated_at = now() WHERE character_id = $1 AND user_id = $2',
          [characterId, userId],
        );
      });
      return store.listByUser(userId);
    },

    async deleteOwned(userId, characterId) {
      const result = await client.query(
        'DELETE FROM characters WHERE character_id = $1 AND user_id = $2',
        [characterId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };

  return store;
}

function mapPostgresCharacter(row: PostgresCharacterRow, key: Buffer): CharacterRow {
  return {
    character_id: Number(row.character_id),
    user_id: row.user_id,
    character_name: row.character_name,
    owner_hash: row.owner_hash,
    scopes: row.scopes,
    refresh_token: decryptSecret(row.refresh_token_enc, key),
    access_token: row.access_token_enc ? decryptSecret(row.access_token_enc, key) : null,
    access_token_expires_at: row.access_token_expires_at == null ? null : dateMs(row.access_token_expires_at),
    added_at: dateMs(row.added_at),
    needs_reauth: row.needs_reauth ? 1 : 0,
    is_boss: row.is_boss ? 1 : 0,
  };
}

function dateMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
