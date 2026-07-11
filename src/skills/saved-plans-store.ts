import type Database from 'better-sqlite3';
import { db as defaultDb } from '../db.ts';

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

export interface SavedSkillPlanStoreOptions {
  now?: () => number;
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
  database: SqliteDatabase = defaultDb,
  options: SavedSkillPlanStoreOptions = {},
): SavedSkillPlanStore {
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
