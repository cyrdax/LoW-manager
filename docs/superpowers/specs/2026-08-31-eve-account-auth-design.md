# EVE Account Authentication Design

## Goal

Allow a signed-out visitor to choose **Continue with EVE**, authorize an EVE character, and immediately enter the app. The same verified EVE authorization creates or resolves the app account, stores the character as an authorized pilot, selects it as the main pilot when needed, and creates a normal app session.

The existing signed-in **Add pilot** flow remains available and distinct from account authentication.

## Approved Product Decisions

- A new EVE character creates a new active app account with no email address.
- The authorized character is added as that account's pilot using the access and refresh tokens returned by the same OAuth exchange.
- The first authorized pilot becomes the account's main pilot.
- An EVE character already linked to an account signs into that existing account.
- An EVE character is never silently moved between app accounts.
- EVE-only accounts use EVE authentication to return to the app. Adding another recovery/login method is outside this change.
- Existing first-account behavior remains: when no non-deleted admin exists, the newly created account becomes an admin; otherwise it is a normal user.

## Considered Architectures

### 1. Use the `characters` row as the login identity

This is the smallest change because `characters.character_id` is already globally unique and points at an app user.

It is rejected because pilot removal would also destroy the account's only login identity. A subsequent EVE login could then create a second app account and strand the original account's data. It also couples authentication identity to mutable pilot/token state.

### 2. Add a dedicated `user_eve_accounts` identity table

This mirrors the existing separation between app users and Google identities while preserving the pilot as independent operational data. Removing a pilot does not remove the EVE login identity; the next successful EVE login restores the pilot to the same account.

This is the selected approach.

### 3. Replace provider-specific tables with a generic auth identity table

A generic `(provider, subject)` identity model would make future providers easier to add, but it would broaden this feature into a migration of working password and Google authentication. That refactor is deferred.

## Identity Model

Add migration `0006_user_eve_accounts.sql` with a table shaped as follows:

```sql
CREATE TABLE user_eve_accounts (
  character_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  owner_hash text NOT NULL,
  linked_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);

CREATE INDEX user_eve_accounts_user_id_idx
  ON user_eve_accounts(user_id);
```

`character_id` is the stable EVE character identity. `owner_hash` records the EVE account owner claim observed when the login identity is first linked. The pair protects app data when a character is transferred to a different EVE owner.

The identity deliberately does not foreign-key to `characters`. It must survive pilot removal so the app account remains recoverable.

## OAuth Entry Points

Add a canonical EVE start route:

- `GET /auth/eve/start?intent=account&returnTo=/...` starts signed-out account authentication.
- `GET /auth/eve/start?intent=add_pilot` requires an existing active app session and starts pilot linking.
- Existing `GET /auth/login` remains as a compatibility alias for the signed-in add-pilot flow.
- The configured EVE callback remains `GET /auth/callback`, avoiding an EVE developer-application callback migration.

OAuth state is one-time, short-lived, and carries server-trusted metadata:

```text
Account auth: { provider: "eve", intent: "account", returnTo: <safe local path> }
Add pilot:    { provider: "eve", intent: "add_pilot", userId: <current user id> }
```

Only local application paths are accepted for `returnTo`. The callback dispatches by the consumed state intent, not by query parameters supplied alongside the callback.

## Account Authentication Flow

1. The signed-out user selects **Continue with EVE** in the auth gate.
2. The server issues one-time OAuth state with `intent: account` and redirects to EVE SSO with the existing pilot scopes.
3. The callback consumes state before exchanging the authorization code.
4. The server exchanges the code, verifies the EVE JWT signature and claims, and obtains:
   - character ID from `sub`;
   - character name;
   - EVE owner hash;
   - granted scopes;
   - access token, refresh token, and access-token expiry.
5. A database transaction locks or creates the EVE identity and resolves the app user.
6. The transaction stores or refreshes the pilot for that same user and sets `main_character_id` when it is null.
7. After the account/pilot transaction commits, the server creates the normal app session, sets the existing secure session cookie, marks the user active, and redirects to the safe local return path.

### New EVE identity

Within one database transaction:

- Recheck that no `user_eve_accounts` row exists for the character.
- Recheck that no legacy `characters` row exists for the character. Existing legacy pilots follow the explicit backfill flow below instead of creating another account.
- Create an active `app_users` row with `email = NULL` and the normal first-admin role selection.
- Insert the `user_eve_accounts` row.
- Insert the encrypted EVE pilot tokens and pilot metadata into `characters` for the new user.
- Set the new user's `main_character_id` to the character.

If any account, identity, or pilot write fails, the transaction rolls back and no partial app account remains.

### Existing EVE identity

Within one database transaction:

- Lock the identity row by character ID.
- Reject disabled or deleted app users.
- Compare the verified `owner` claim with the stored `owner_hash` using an exact comparison.
- If it matches, upsert the pilot under the identity's existing `user_id`, refresh its encrypted tokens and metadata, and set it as main pilot only when the account currently has no main pilot.
- Update `last_login_at`.

The login does not change the account's email, role, or existing main pilot.

### Existing pilot without an EVE identity

Pilots authorized before this feature have `characters` rows but no `user_eve_accounts` rows. Choosing **Continue with EVE** is an explicit request to use that character as an account credential.

Within one database transaction:

- Lock the legacy pilot row by character ID.
- Reject missing, disabled, or deleted owning app users.
- Require the verified EVE owner hash to match the pilot's stored owner hash.
- Insert `user_eve_accounts` for the pilot's existing `user_id`; never create a second account and never change the pilot's owner.
- Refresh the pilot metadata and encrypted tokens.
- Set the pilot as main only if the existing account currently has no main pilot.

If the owner hash does not match, fail with the same neutral character-transfer response used for an existing EVE identity. Concurrent callbacks are serialized by row/identity uniqueness and resolve to one account.

## Character Transfer Protection

If the character ID matches an EVE identity but the owner hash differs, authentication fails. The callback must not:

- update the stored owner hash;
- issue an app session;
- move the pilot;
- expose the existing account's email, role, pilot list, or other private details.

The user receives a neutral message explaining that the EVE character's ownership no longer matches the account link and that account support is required. An explicit audited recovery or ownership-transfer workflow is future work.

## Existing Add-Pilot Flow

The signed-in flow continues to bind OAuth state to the current app user. Its callback gains strict collision handling:

- An unclaimed character is linked to the signed-in user.
- A character already owned by the same user is reauthorized and its tokens are refreshed.
- A character mapped by `user_eve_accounts` or `characters` to another user is rejected.
- An owner-hash mismatch is rejected.
- No existing pilot row may have its `user_id` overwritten by an authorization callback.

The SQLite and PostgreSQL character-store upsert behavior must be hardened so a direct store call cannot silently reassign an existing character. Ownership transfer remains an explicit administrative operation, not an upsert side effect.

## Session and Account Behavior

EVE-created users are ordinary active `AppUser` records and use the application normally after callback completion. Their session uses the same:

- server-side session store;
- opaque cookie value;
- HTTP-only and SameSite settings;
- production `Secure` setting;
- activity tracking;
- account-status checks;
- expiration and logout behavior

as password and Google sign-in.

Shared session issuance and cookie helpers should be extracted from the current app-auth route implementation rather than duplicated in EVE SSO code.

Because EVE supplies no verified email address, EVE-created accounts have `email = NULL`. User-facing labels continue to derive from the main pilot. Password reset and email verification are unavailable until a future explicit email-linking feature is built.

## UI Behavior

The authentication gate adds a **Continue with EVE** action alongside the existing Google and password choices. It is available in both sign-in and account-creation modes because the callback decides whether to resolve or create the account.

On success, the callback redirects into the app instead of displaying the current "close this tab" pilot-link page. The signed-in **Add pilot** action retains the close-window behavior.

Expected callback failures redirect back to the auth gate with a safe error code that maps to user-friendly text. Raw EVE responses, OAuth codes, state values, tokens, owner hashes, and account identifiers are never placed in the URL or rendered to the browser.

## Service Boundaries

Introduce an EVE account-auth service responsible for the transaction described above. The route remains responsible only for:

- state and request validation;
- code exchange and JWT verification;
- calling the account-auth service with verified identity/token data;
- session issuance and response behavior.

The service returns an existing or newly created active `AppUser`. Production uses a single PostgreSQL transaction and client-bound user/character operations. Fakes used by route tests implement the same observable contract.

The app-user store gains only the EVE-specific create/resolve operations needed by the service. Google and password behavior remains unchanged.

## Error Handling

Expected outcomes use stable internal error codes:

- invalid, missing, expired, or replayed OAuth state;
- EVE token exchange or JWT verification failure;
- disabled/deleted account;
- character linked to another account;
- EVE owner mismatch;
- database transaction failure;
- session issuance failure.

Errors are logged with request correlation and safe identifiers where useful, but never with access tokens, refresh tokens, OAuth codes, raw state, or owner hashes. Browser messages remain neutral where account existence or ownership is sensitive.

## Testing

### Route and service tests

- Account-intent start works without an app session and stores safe state metadata.
- Add-pilot intent still requires an active session and stores its user ID in state.
- Unsafe external `returnTo` values fall back to `/`.
- New EVE auth creates one account, one identity, one pilot, and a main-pilot assignment.
- New EVE auth issues a readable normal app session and redirects locally.
- Repeat EVE auth signs into the same account and does not create duplicates.
- Repeat auth refreshes the pilot tokens and restores a removed pilot to the same account.
- Existing main-pilot selection is preserved.
- Disabled/deleted accounts cannot sign in.
- Owner-hash mismatch issues no session and changes no identity or pilot ownership.
- Character collisions never transfer ownership.
- Replayed/expired state is rejected before code exchange.
- Database failure rolls back account, identity, and pilot writes.
- Session failure leaves a valid recoverable account but no browser session.
- Existing add-pilot success and close-window behavior remain intact.

### Store and migration tests

- Migration creates the EVE identity primary key, user foreign key, and index.
- First EVE-created user receives admin only when no non-deleted admin exists.
- PostgreSQL transaction handles concurrent first login for the same character without duplicate accounts.
- SQLite and PostgreSQL pilot upserts reject cross-user reassignment.
- Encrypted tokens remain encrypted at rest.

### Frontend tests

- Auth gate renders **Continue with EVE** for sign-in and signup.
- The button uses account intent and preserves only a safe local return path.
- Known callback error codes render useful messages without leaking details.
- Existing Google/password flows and signed-in **Add pilot** controls remain present.

## Rollout and Compatibility

- Apply the new migration before deploying the routes.
- Existing pilots do not automatically become EVE login identities. This avoids unexpectedly turning every authorized operational pilot into an account credential.
- A user who explicitly chooses **Continue with EVE** with an existing pilot may be safely backfilled only when that pilot has one unambiguous owner and its verified owner hash matches the stored pilot owner hash.
- Existing `/auth/login` and `/auth/callback` pilot authorization links remain compatible during the rollout.
- No EVE client ID, callback URL, or scope change is required.

## Non-Goals

- Linking email/password or Google credentials from inside an EVE-only account.
- Automatic account merging based on character, owner hash, corporation, alliance, or guessed identity.
- Automatic character ownership transfer.
- Admin recovery UI for owner-hash changes.
- Converting Google authentication to a generic provider table.
- Changing EVE scopes or unrelated pilot polling behavior.

## Acceptance Criteria

- A signed-out user can create an account with EVE and reach the normal app in one OAuth round trip.
- The authorized character exists as that account's usable pilot with valid stored tokens and is its main pilot when no main pilot existed.
- Reusing that EVE identity signs into the same account.
- No authorization path can silently transfer a pilot or app account between users.
- A transferred EVE character cannot access the former owner's app account.
- Password, Google, session, and signed-in add-pilot behavior continue to work.
