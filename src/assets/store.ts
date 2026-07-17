import type Database from 'better-sqlite3';
import type { QueryClient } from '../db/migrations.ts';
import { getPostgresPool } from '../db/postgres.ts';
import { ASSET_STALE_MS, type AssetPilotStatus, type AssetSnapshot } from './types.ts';

type SqliteDatabase = Database.Database;

export interface AssetSnapshotStore {
  listSnapshots(userId: string, now?: number): Promise<AssetSnapshot[]> | AssetSnapshot[];
  replaceSnapshot(userId: string, snapshot: AssetSnapshot): Promise<void> | void;
  recordPilotStatus(
    userId: string,
    characterId: number,
    characterName: string,
    status: AssetPilotStatus,
    error: string | null,
    now: number,
  ): Promise<void> | void;
  deleteForUser(userId: string): Promise<void> | void;
}

export function migrateAssetSnapshotsDb(database: SqliteDatabase): void {
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_user_character
      ON characters(user_id, character_id);

    CREATE TABLE IF NOT EXISTS asset_snapshots (
      user_id TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      character_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      last_refreshed_at INTEGER,
      snapshot_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, character_id),
      FOREIGN KEY (user_id, character_id)
        REFERENCES characters(user_id, character_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_asset_snapshots_user ON asset_snapshots(user_id);
  `);
}

export function createSqliteAssetSnapshotStore(database: SqliteDatabase): AssetSnapshotStore {
  return {
    listSnapshots(userId, now = Date.now()) {
      const rows = database.prepare(`
        SELECT snapshot_json FROM asset_snapshots WHERE user_id = ? ORDER BY character_name
      `).all(userId) as Array<{ snapshot_json: string }>;
      return rows.map(row => withStaleStatus(JSON.parse(row.snapshot_json) as AssetSnapshot, now));
    },

    replaceSnapshot(userId, snapshot) {
      database.prepare(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          last_refreshed_at = excluded.last_refreshed_at,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(
        userId,
        snapshot.pilot.characterId,
        snapshot.pilot.characterName,
        snapshot.pilot.status,
        snapshot.pilot.error,
        snapshot.pilot.lastRefreshedAt,
        JSON.stringify(snapshot),
        Date.now(),
      );
    },

    recordPilotStatus(userId, characterId, characterName, status, error, now) {
      const previous = database.prepare(`
        SELECT snapshot_json FROM asset_snapshots WHERE user_id = ? AND character_id = ?
      `).get(userId, characterId) as { snapshot_json: string } | undefined;
      const snapshot = previous
        ? withPilotStatus(JSON.parse(previous.snapshot_json) as AssetSnapshot, characterName, status, error)
        : emptySnapshot(characterId, characterName, status, error);
      database.prepare(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          last_refreshed_at = excluded.last_refreshed_at,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(userId, characterId, characterName, status, error, snapshot.pilot.lastRefreshedAt, JSON.stringify(snapshot), now);
    },

    deleteForUser(userId) {
      database.prepare('DELETE FROM asset_snapshots WHERE user_id = ?').run(userId);
    },
  };
}

export function createPostgresAssetSnapshotStore(client: QueryClient = getPostgresPool()): AssetSnapshotStore {
  return {
    async listSnapshots(userId, now = Date.now()) {
      const rows = await client.query<{ snapshot_json: AssetSnapshot | string }>(
        'SELECT snapshot_json FROM asset_snapshots WHERE user_id = $1 ORDER BY character_name',
        [userId],
      );
      return rows.rows.map(row => withStaleStatus(
        typeof row.snapshot_json === 'string'
          ? JSON.parse(row.snapshot_json) as AssetSnapshot
          : row.snapshot_json,
        now,
      ));
    },

    async replaceSnapshot(userId, snapshot) {
      await client.query(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7::jsonb, NOW())
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          last_refreshed_at = excluded.last_refreshed_at,
          snapshot_json = excluded.snapshot_json,
          updated_at = NOW()
      `, [
        userId,
        snapshot.pilot.characterId,
        snapshot.pilot.characterName,
        snapshot.pilot.status,
        snapshot.pilot.error,
        snapshot.pilot.lastRefreshedAt,
        JSON.stringify(snapshot),
      ]);
    },

    async recordPilotStatus(userId, characterId, characterName, status, error, now) {
      const snapshot = emptySnapshot(characterId, characterName, status, error);
      await client.query(`
        INSERT INTO asset_snapshots (
          user_id, character_id, character_name, status, error, last_refreshed_at, snapshot_json, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb, to_timestamp($7 / 1000.0))
        ON CONFLICT(user_id, character_id) DO UPDATE SET
          character_name = excluded.character_name,
          status = excluded.status,
          error = excluded.error,
          last_refreshed_at = asset_snapshots.last_refreshed_at,
          snapshot_json = jsonb_set(
            jsonb_set(
              jsonb_set(asset_snapshots.snapshot_json, '{pilot,characterName}', to_jsonb(excluded.character_name), true),
              '{pilot,status}', to_jsonb(excluded.status), true
            ),
            '{pilot,error}', CASE WHEN excluded.error IS NULL THEN 'null'::jsonb ELSE to_jsonb(excluded.error) END, true
          ),
          updated_at = excluded.updated_at
      `, [userId, characterId, characterName, status, error, JSON.stringify(snapshot), now]);
    },

    async deleteForUser(userId) {
      await client.query('DELETE FROM asset_snapshots WHERE user_id = $1', [userId]);
    },
  };
}

function emptySnapshot(
  characterId: number,
  characterName: string,
  status: AssetPilotStatus,
  error: string | null,
): AssetSnapshot {
  return {
    pilot: {
      characterId,
      characterName,
      status,
      error,
      lastRefreshedAt: null,
      locationCount: 0,
      itemCount: 0,
      stackCount: 0,
      pricedValue: 0,
      totalValue: 0,
      unpricedStacks: 0,
    },
    locations: [],
    categories: [],
  };
}

function withPilotStatus(
  snapshot: AssetSnapshot,
  characterName: string,
  status: AssetPilotStatus,
  error: string | null,
): AssetSnapshot {
  return {
    ...snapshot,
    pilot: { ...snapshot.pilot, characterName, status, error },
  };
}

function withStaleStatus(snapshot: AssetSnapshot, now: number): AssetSnapshot {
  if (
    snapshot.pilot.status === 'Ready'
    && snapshot.pilot.lastRefreshedAt != null
    && now - snapshot.pilot.lastRefreshedAt > ASSET_STALE_MS
  ) {
    return { ...snapshot, pilot: { ...snapshot.pilot, status: 'Stale' } };
  }
  return snapshot;
}
