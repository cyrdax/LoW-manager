import type Database from 'better-sqlite3';
import { db as defaultDb } from '../db.ts';
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

export interface CharacterStore {
  listAll(): CharacterRow[];
  listByUser(userId: string): CharacterRow[];
  listUsableByUser(userId: string): CharacterRow[];
  listIdsByUser(userId: string): number[];
  getById(characterId: number): CharacterRow | undefined;
  getOwned(userId: string, characterId: number): CharacterRow | undefined;
  owns(userId: string, characterId: number): boolean;
  upsertAuthorized(input: AuthorizedCharacterInput): CharacterRow;
  setBoss(userId: string, characterId: number): CharacterRow[];
  deleteOwned(userId: string, characterId: number): boolean;
}

export interface CharacterStoreOptions {
  now?: () => number;
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
