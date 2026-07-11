# Multi-Tenant Schema Plan

## Overview

The app will hard-cut mutable state from SQLite to Postgres. Static SDE JSON and generated data files remain on disk. Public caches stay global. Private user and pilot state is keyed by `user_id`.

Use plain SQL migrations in `src/db/migrations`. The runtime applies migrations at startup before registering routes. Tests use an isolated Postgres database configured by `TEST_DATABASE_URL`.

## Extensions And Conventions

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Conventions:

- Primary keys use UUID for app-owned entities and EVE numeric IDs for EVE entities.
- Timestamps use `timestamptz`.
- JSON uses `jsonb`.
- Token columns store encrypted envelopes, not raw token strings.
- Tables that contain private user data have `user_id uuid NOT NULL`.
- Public/global tables do not have `user_id`.

## Auth Tables

### app_users

```sql
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'disabled', 'deleted');

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  email_verified_at timestamptz,
  role user_role NOT NULL DEFAULT 'user',
  status user_status NOT NULL DEFAULT 'active',
  main_character_id bigint,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_app_users_last_active ON app_users(last_active_at);
CREATE INDEX idx_app_users_status ON app_users(status);
```

`email` is nullable only for edge cases while linking Google before email normalization. Normal app accounts should have an email.

### user_password_credentials

```sql
CREATE TABLE user_password_credentials (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### user_google_accounts

```sql
CREATE TABLE user_google_accounts (
  google_sub text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_google_accounts_user ON user_google_accounts(user_id);
```

### user_sessions

```sql
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip_hash text,
  user_agent_hash text
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
```

### auth_tokens

Used for email verification, password reset, Google OAuth state, and EVE OAuth state.

```sql
CREATE TYPE auth_token_purpose AS ENUM (
  'email_verification',
  'password_reset',
  'google_oauth_state',
  'eve_oauth_state'
);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  purpose auth_token_purpose NOT NULL,
  token_hash text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_purpose ON auth_tokens(purpose, expires_at);
```

## EVE Pilot Tables

### characters

Replaces the current global SQLite `characters` table with user ownership.

```sql
CREATE TABLE characters (
  character_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  character_name text NOT NULL,
  owner_hash text NOT NULL,
  corporation_id bigint,
  corporation_name text,
  corporation_ticker text,
  portrait_url text,
  scopes text NOT NULL,
  refresh_token_enc jsonb NOT NULL,
  access_token_enc jsonb,
  access_token_expires_at timestamptz,
  added_at timestamptz NOT NULL DEFAULT now(),
  needs_reauth boolean NOT NULL DEFAULT false,
  is_boss boolean NOT NULL DEFAULT false,
  last_polled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_characters_single_owner ON characters(character_id);
CREATE INDEX idx_characters_user ON characters(user_id);
CREATE INDEX idx_characters_polling ON characters(user_id, needs_reauth, last_polled_at);
```

Add a deferred app-level invariant: `app_users.main_character_id`, when set, must reference a character owned by that user.

### character_status_snapshots

Stores private ESI status snapshots that are currently kept in polling memory.

```sql
CREATE TABLE character_status_snapshots (
  character_id bigint PRIMARY KEY REFERENCES characters(character_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_character_status_snapshots_user ON character_status_snapshots(user_id, updated_at);
```

## User-Owned App Tables

### saved_skill_plans

```sql
CREATE TABLE saved_skill_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  character_id bigint REFERENCES characters(character_id) ON DELETE CASCADE,
  ship_id bigint NOT NULL,
  mastery_level integer NOT NULL,
  label text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, character_id, ship_id, mastery_level)
);

CREATE INDEX idx_saved_skill_plans_user ON saved_skill_plans(user_id);
```

### saved_fits

```sql
CREATE TYPE library_visibility AS ENUM ('private', 'public', 'archived');

CREATE TABLE saved_fits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_users(id),
  visibility library_visibility NOT NULL DEFAULT 'private',
  source_public_fit_id uuid REFERENCES saved_fits(id) ON DELETE SET NULL,
  ship_type_id bigint NOT NULL,
  ship_name text NOT NULL,
  fit_name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  raw_eft text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX idx_saved_fits_private_owner ON saved_fits(owner_user_id, updated_at DESC) WHERE visibility = 'private';
CREATE INDEX idx_saved_fits_public ON saved_fits(updated_at DESC) WHERE visibility = 'public';
CREATE INDEX idx_saved_fits_ship ON saved_fits(ship_name);
```

### saved_fit_items

```sql
CREATE TABLE saved_fit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fit_id uuid NOT NULL REFERENCES saved_fits(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'fit-line',
  section_index integer NOT NULL,
  line_index integer NOT NULL,
  raw_line text NOT NULL,
  input_name text NOT NULL,
  resolved_name text,
  type_id bigint,
  quantity integer NOT NULL,
  role text NOT NULL,
  slot_flag text,
  warning jsonb
);

CREATE INDEX idx_saved_fit_items_fit ON saved_fit_items(fit_id);
```

### doctrines

```sql
CREATE TABLE doctrines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_users(id),
  visibility library_visibility NOT NULL DEFAULT 'private',
  source_public_doctrine_id uuid REFERENCES doctrines(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX idx_doctrines_private_owner ON doctrines(owner_user_id, updated_at DESC) WHERE visibility = 'private';
CREATE INDEX idx_doctrines_public ON doctrines(updated_at DESC) WHERE visibility = 'public';
```

### doctrine_fits

```sql
CREATE TABLE doctrine_fits (
  doctrine_id uuid NOT NULL REFERENCES doctrines(id) ON DELETE CASCADE,
  fit_id uuid NOT NULL REFERENCES saved_fits(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  PRIMARY KEY (doctrine_id, fit_id)
);

CREATE INDEX idx_doctrine_fits_doctrine ON doctrine_fits(doctrine_id, sort_order);
CREATE INDEX idx_doctrine_fits_fit ON doctrine_fits(fit_id);
```

App invariant: public doctrines can only link public fits.

## Global Public Cache Tables

Keep these globally shared:

- `universe_names`
- `corporations`
- `saved_systems`
- Contract index tables from `src/contracts/index-store.ts`
- Market/public pricing cache tables if added later

These tables have no `user_id`.

## Audit Tables

```sql
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
CREATE INDEX idx_audit_events_actor ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_events_target ON audit_events(target_user_id, created_at DESC);
```

When deleting users, anonymize user references where required by setting deleted users to a retained admin owner for public library rows and preserving audit metadata without secrets.

## SQLite Import Mapping

The import script accepts:

- `SQLITE_DB_PATH`
- `DATABASE_URL`
- `ADMIN_EMAIL`

Import behavior:

- Create admin user if missing.
- Import existing `characters` as owned by admin.
- Encrypt existing EVE tokens during import.
- Import `saved_fits` as admin private fits.
- Import `doctrines` as admin private doctrines.
- Import `saved_skill_plans` as admin private skill plans.
- Import global cache tables without user ownership.
- Preserve created/updated timestamps where possible.

## Deletion Behavior

Account deletion transaction:

1. Pick an admin transfer target.
2. Reassign public fits/doctrines owned by the deleted user to admin ownership.
3. Delete private doctrines owned by the user.
4. Delete private fits owned by the user.
5. Delete characters and private pilot snapshots.
6. Delete sessions and auth tokens.
7. Mark `app_users.status = 'deleted'`, clear email/main pilot fields, and set `deleted_at`.
8. Write an anonymized audit event.

## Migration Order

1. Auth primitives and audit tables.
2. Global cache tables.
3. Character ownership and status snapshot tables.
4. Saved skill plans.
5. Saved fits and fit items.
6. Doctrines and doctrine members.
7. Import script.
8. Remove SQLite runtime dependency after all stores/routes use Postgres.
