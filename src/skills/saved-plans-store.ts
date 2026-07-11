import type Database from 'better-sqlite3';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';

type SqliteDatabase = Database.Database;

export interface SavedSkillPlanRow {
  id: number;
  user_id: string | null;
  character_id: number;
  ship_id: number;
  mastery_level: number;
  label: string | null;
  saved_at: number;
}

export interface SaveSkillPlanInput {
  userId: string;
  characterId: number;
  shipId: number;
  masteryLevel: number;
  label?: string | null;
}

export interface SavedSkillPlanStore {
  list(userId: string, characterId?: number): SavedSkillPlanRow[];
  save(input: SaveSkillPlanInput): SavedSkillPlanRow;
  delete(userId: string, id: number): boolean;
}

export interface AsyncSavedSkillPlanStore {
  list(userId: string, characterId?: number): Promise<SavedSkillPlanRow[]>;
  save(input: SaveSkillPlanInput): Promise<SavedSkillPlanRow>;
  delete(userId: string, id: number): Promise<boolean>;
}

export interface SavedSkillPlanStoreOptions {
  now?: () => number;
}

export interface PostgresSavedSkillPlanStoreOptions {
  now?: () => Date;
}

interface PostgresSavedSkillPlanRow {
  id: string | number;
  user_id: string;
  character_id: string | number;
  ship_id: string | number;
  mastery_level: string | number;
  label: string | null;
  saved_at: Date | string | number;
}

export function migrateSavedSkillPlansDb(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS saved_skill_plans (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT,
      character_id   INTEGER NOT NULL,
      ship_id        INTEGER NOT NULL,
      mastery_level  INTEGER NOT NULL,
      label          TEXT,
      saved_at       INTEGER NOT NULL,
      UNIQUE(character_id, ship_id, mastery_level)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_skill_plans_char ON saved_skill_plans(character_id);
  `);

  const columns = database.prepare('PRAGMA table_info(saved_skill_plans)').all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'user_id')) {
    database.prepare('ALTER TABLE saved_skill_plans ADD COLUMN user_id TEXT').run();
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_saved_skill_plans_user ON saved_skill_plans(user_id);');
}

export function createSavedSkillPlanStore(
  inputDatabase?: SqliteDatabase,
  options: SavedSkillPlanStoreOptions = {},
): SavedSkillPlanStore {
  const database = inputDatabase ?? missingSqliteDatabase('createSavedSkillPlanStore');
  const now = options.now ?? (() => Date.now());

  return {
    list(userId, characterId) {
      if (characterId != null) {
        return database.prepare(`
          SELECT * FROM saved_skill_plans
          WHERE user_id = ? AND character_id = ?
          ORDER BY saved_at DESC
        `).all(userId, characterId) as SavedSkillPlanRow[];
      }
      return database.prepare(`
        SELECT * FROM saved_skill_plans
        WHERE user_id = ?
        ORDER BY saved_at DESC
      `).all(userId) as SavedSkillPlanRow[];
    },

    save(input) {
      const savedAt = now();
      database.prepare(`
        INSERT INTO saved_skill_plans (user_id, character_id, ship_id, mastery_level, label, saved_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(character_id, ship_id, mastery_level)
        DO UPDATE SET user_id = excluded.user_id, label = excluded.label, saved_at = excluded.saved_at
      `).run(input.userId, input.characterId, input.shipId, input.masteryLevel, input.label ?? null, savedAt);
      return database.prepare(`
        SELECT * FROM saved_skill_plans
        WHERE character_id = ? AND ship_id = ? AND mastery_level = ?
      `).get(input.characterId, input.shipId, input.masteryLevel) as SavedSkillPlanRow;
    },

    delete(userId, id) {
      const result = database.prepare('DELETE FROM saved_skill_plans WHERE id = ? AND user_id = ?').run(id, userId);
      return result.changes > 0;
    },
  };
}

function missingSqliteDatabase(factoryName: string): never {
  throw new Error(`${factoryName} requires an explicit SQLite database`);
}

export function createPostgresSavedSkillPlanStore(
  client: QueryClient = getPostgresPool(),
  options: PostgresSavedSkillPlanStoreOptions = {},
): AsyncSavedSkillPlanStore {
  const now = options.now ?? (() => new Date());

  return {
    async list(userId, characterId) {
      const result = characterId == null
        ? await client.query<PostgresSavedSkillPlanRow>(
          `
            SELECT id, user_id, character_id, ship_id, mastery_level, label, saved_at
            FROM saved_skill_plans
            WHERE user_id = $1
            ORDER BY saved_at DESC
          `,
          [userId],
        )
        : await client.query<PostgresSavedSkillPlanRow>(
          `
            SELECT id, user_id, character_id, ship_id, mastery_level, label, saved_at
            FROM saved_skill_plans
            WHERE user_id = $1 AND character_id = $2
            ORDER BY saved_at DESC
          `,
          [userId, characterId],
        );
      return result.rows.map(mapPostgresRow);
    },

    async save(input) {
      const result = await client.query<PostgresSavedSkillPlanRow>(
        `
          INSERT INTO saved_skill_plans (user_id, character_id, ship_id, mastery_level, label, saved_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT(user_id, character_id, ship_id, mastery_level)
          DO UPDATE SET label = excluded.label, saved_at = excluded.saved_at
          RETURNING id, user_id, character_id, ship_id, mastery_level, label, saved_at
        `,
        [input.userId, input.characterId, input.shipId, input.masteryLevel, input.label ?? null, now()],
      );
      return mapPostgresRow(result.rows[0]);
    },

    async delete(userId, id) {
      const result = await client.query(
        'DELETE FROM saved_skill_plans WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

function mapPostgresRow(row: PostgresSavedSkillPlanRow): SavedSkillPlanRow {
  return {
    id: Number(row.id),
    user_id: row.user_id,
    character_id: Number(row.character_id),
    ship_id: Number(row.ship_id),
    mastery_level: Number(row.mastery_level),
    label: row.label,
    saved_at: toEpochMs(row.saved_at),
  };
}

function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}
