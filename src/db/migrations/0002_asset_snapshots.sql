ALTER TABLE characters
  ADD CONSTRAINT characters_user_id_character_id_key UNIQUE (user_id, character_id);

CREATE TABLE IF NOT EXISTS asset_snapshots (
  user_id            uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  character_id       bigint NOT NULL,
  character_name     text NOT NULL,
  status             text NOT NULL,
  error              text,
  last_refreshed_at  timestamptz,
  snapshot_json      jsonb NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id),
  FOREIGN KEY (user_id, character_id)
    REFERENCES characters(user_id, character_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_snapshots_user ON asset_snapshots(user_id);
