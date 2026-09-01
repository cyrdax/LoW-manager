CREATE TABLE IF NOT EXISTS user_eve_accounts (
  character_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  owner_hash text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_eve_accounts_user_id_idx
  ON user_eve_accounts(user_id);
