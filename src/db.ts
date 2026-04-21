import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? 'data/app.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    character_id            INTEGER PRIMARY KEY,
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

  CREATE TABLE IF NOT EXISTS universe_names (
    category TEXT NOT NULL,
    id       INTEGER NOT NULL,
    name     TEXT NOT NULL,
    PRIMARY KEY (category, id)
  );

  CREATE TABLE IF NOT EXISTS corporations (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    ticker TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`);

// Housekeeping: drop oauth_states entries older than 10 minutes.
db.prepare(`DELETE FROM oauth_states WHERE created_at < ?`).run(Date.now() - 10 * 60 * 1000);

export function nowMs(): number {
  return Date.now();
}
