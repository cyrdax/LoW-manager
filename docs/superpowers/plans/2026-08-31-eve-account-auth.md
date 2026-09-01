# EVE Account Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-out visitor authenticate with an EVE character, create or recover the correct app account, add or refresh that character as a pilot, and enter the normal application session in one OAuth round trip.

**Architecture:** Add a durable EVE login-identity table separate from mutable pilot rows. A PostgreSQL transaction serialized by character ID resolves an existing identity, safely backfills a legacy pilot, or creates the user/identity/pilot tuple; EVE owner-hash mismatches and cross-user pilot writes fail closed. The EVE callback reuses shared session-cookie behavior and dispatches account login versus signed-in pilot linking from consumed one-time OAuth state.

**Tech Stack:** TypeScript, Fastify, PostgreSQL migrations and transactions, `jose` EVE JWT verification, encrypted EVE tokens, React, Node test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-08-31-eve-account-auth-design.md`

## Global Constraints

- Preserve the existing password, Google OAuth, session, and signed-in add-pilot behavior.
- `user_eve_accounts` survives pilot removal and is deleted only with its app user.
- A character ID may resolve to exactly one app account; no normal upsert may change `characters.user_id`.
- A stored EVE owner hash is immutable through normal login. A mismatch issues no session and changes no ownership.
- New EVE accounts use `email = NULL`, are active immediately, and retain the existing first-non-deleted-admin role rule.
- OAuth state is one-time and short-lived; redirects accept only local paths beginning with one `/`.
- EVE access tokens, refresh tokens, authorization codes, OAuth state, and owner hashes never appear in browser URLs or logs.
- Production EVE tokens remain encrypted at rest with `TOKEN_ENCRYPTION_KEY`.
- Existing pilots become EVE login identities only after an explicit **Continue with EVE** authorization with a matching owner hash.
- Do not stage or rewrite the pre-existing fit UI work. Every commit in this plan uses explicit auth/database/frontend paths rather than `git add -A`.

## File Structure

- Create `src/db/migrations/0006_user_eve_accounts.sql`: durable EVE-to-app-user identity schema.
- Modify `src/db/migrations.test.ts`: migration contract coverage.
- Modify `src/characters/store.ts`: strict non-transferring authorized-character upsert and transaction-aware PostgreSQL helper.
- Modify `src/characters/store.test.ts`: SQLite ownership and owner-hash regression coverage.
- Modify `src/characters/postgres-store.test.ts`: PostgreSQL conflict behavior and encrypted-token coverage.
- Create `src/auth/eve-account-auth.ts`: atomic EVE account resolution/creation service.
- Create `src/auth/eve-account-auth.test.ts`: new, repeat, legacy-backfill, transfer, status, and rollback tests.
- Create `src/auth/session-http.ts`: shared session metadata, cookie, and local-return helpers.
- Create `src/auth/session-http.test.ts`: cookie and redirect-sanitization tests.
- Modify `src/auth/app-auth-routes.ts`: consume shared session HTTP helpers with no behavior change.
- Modify `src/auth/app-auth-routes.test.ts`: regression assertions for shared cookie behavior.
- Modify `src/auth/sso.ts`: account/add-pilot start intents and callback dispatch.
- Modify `src/auth/sso.test.ts`: full EVE route behavior with injected exchange/JWT dependencies.
- Modify `src/server.ts`: share production users/sessions/OAuth state/character/account-auth dependencies.
- Modify `web/src/components/AuthGate.tsx`: **Continue with EVE** entry and callback error labels.
- Modify `src/auth/frontend-auth-view.test.ts`: auth-gate wiring assertions.
- Create `web/src/components/AuthGate.css`: auth-provider layout and EVE button styling isolated from the already-modified global stylesheet.

---

### Task 1: Persist EVE Login Identities

**Files:**
- Create: `src/db/migrations/0006_user_eve_accounts.sql`
- Modify: `src/db/migrations.test.ts:117-126`

**Interfaces:**
- Consumes: existing `app_users(id)` UUID primary key.
- Produces: `user_eve_accounts(character_id bigint PRIMARY KEY, user_id uuid, owner_hash text, linked_at timestamptz, last_login_at timestamptz)` and `user_eve_accounts_user_id_idx`.

- [ ] **Step 1: Write the failing migration contract test**

Append this test to `src/db/migrations.test.ts`:

```ts
test('EVE account identity migration keeps login identity separate from pilots', () => {
  const sql = readFileSync(resolve('src/db/migrations/0006_user_eve_accounts.sql'), 'utf8');
  const block = tableBlock(sql, 'user_eve_accounts');

  assert.match(block, /character_id\s+bigint PRIMARY KEY/);
  assert.match(block, /user_id\s+uuid NOT NULL REFERENCES app_users\(id\) ON DELETE CASCADE/);
  assert.match(block, /owner_hash\s+text NOT NULL/);
  assert.match(block, /linked_at\s+timestamptz NOT NULL/);
  assert.match(block, /last_login_at\s+timestamptz NOT NULL/);
  assert.match(sql, /CREATE INDEX user_eve_accounts_user_id_idx\s+ON user_eve_accounts\(user_id\)/);
  assert.doesNotMatch(block, /REFERENCES characters/);
});
```

- [ ] **Step 2: Run the migration test and verify the missing-file failure**

Run: `node --import tsx --test src/db/migrations.test.ts`

Expected: FAIL because `0006_user_eve_accounts.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `src/db/migrations/0006_user_eve_accounts.sql`:

```sql
CREATE TABLE IF NOT EXISTS user_eve_accounts (
  character_id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  owner_hash text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_eve_accounts_user_id_idx
  ON user_eve_accounts(user_id);
```

- [ ] **Step 4: Run migration tests**

Run: `node --import tsx --test src/db/migrations.test.ts`

Expected: PASS, including the new EVE identity contract.

- [ ] **Step 5: Commit the migration**

```bash
git add src/db/migrations/0006_user_eve_accounts.sql src/db/migrations.test.ts
git commit -m "feat: add EVE account identity schema"
```

---

### Task 2: Make Pilot Authorization Non-Transferring

**Files:**
- Modify: `src/characters/store.ts:16-205,316-359`
- Modify: `src/characters/store.test.ts`
- Modify: `src/characters/postgres-store.test.ts`

**Interfaces:**
- Consumes: existing `AuthorizedCharacterInput` and `CharacterRow`.
- Produces: `CharacterOwnershipError`, `CharacterOwnerMismatchError`, and `upsertPostgresAuthorizedCharacter(client, input, options): Promise<CharacterRow>` for use inside a caller-owned transaction.

- [ ] **Step 1: Write failing SQLite ownership tests**

Add tests that authorize character `9001` for `user-a`, then assert both of these reject without changing the stored row:

```ts
assert.throws(
  () => store.upsertAuthorized({ ...authorized, userId: 'user-b' }),
  CharacterOwnershipError,
);
assert.throws(
  () => store.upsertAuthorized({ ...authorized, ownerHash: 'changed-owner' }),
  CharacterOwnerMismatchError,
);
assert.equal(store.getById(9001)?.user_id, 'user-a');
assert.equal(store.getById(9001)?.owner_hash, 'owner-a');
```

Use a complete `authorized` fixture with character name, scopes, refresh/access tokens, and expiry so the test exercises the real upsert.

- [ ] **Step 2: Write failing PostgreSQL ownership tests**

Extend the fake query client so its character upsert can return no rows for an ownership predicate failure. Assert:

```ts
await assert.rejects(
  store.upsertAuthorized({ ...authorized, userId: 'user-b' }),
  CharacterOwnershipError,
);
await assert.rejects(
  store.upsertAuthorized({ ...authorized, ownerHash: 'changed-owner' }),
  CharacterOwnerMismatchError,
);
```

Also assert the generated conflict SQL does not contain `user_id = excluded.user_id` or `owner_hash = excluded.owner_hash`.

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `node --import tsx --test src/characters/store.test.ts src/characters/postgres-store.test.ts`

Expected: FAIL because cross-user and owner-hash writes are still accepted and the error classes/helper do not exist.

- [ ] **Step 4: Implement strict ownership errors and SQLite validation**

Add these exported errors to `src/characters/store.ts`:

```ts
export class CharacterOwnershipError extends Error {
  constructor(readonly characterId: number) {
    super('character_linked_elsewhere');
    this.name = 'CharacterOwnershipError';
  }
}

export class CharacterOwnerMismatchError extends Error {
  constructor(readonly characterId: number) {
    super('eve_owner_mismatch');
    this.name = 'CharacterOwnerMismatchError';
  }
}
```

At the start of the SQLite transaction, read the existing character. Throw `CharacterOwnershipError` when `user_id` differs and `CharacterOwnerMismatchError` when `owner_hash` differs. Remove `user_id` and `owner_hash` from the SQLite conflict-update assignments.

- [ ] **Step 5: Extract and use the transaction-aware PostgreSQL helper**

Export this signature:

```ts
export interface PostgresAuthorizedCharacterOptions {
  now?: () => Date;
  secretKey?: Buffer;
}

export async function upsertPostgresAuthorizedCharacter(
  client: QueryClient,
  input: AuthorizedCharacterInput,
  options: PostgresAuthorizedCharacterOptions = {},
): Promise<CharacterRow>
```

The helper must:

1. `SELECT user_id, owner_hash FROM characters WHERE character_id = $1 FOR UPDATE`.
2. Throw the matching typed error before deleting snapshots or changing tokens.
3. Delete only stale cross-user snapshots after validation.
4. Insert or update character metadata/tokens while never updating `user_id` or `owner_hash` in `ON CONFLICT`.
5. Encrypt refresh/access tokens through the existing secret-box functions and map the returned row through the existing PostgreSQL mapper.

Change `createPostgresCharacterStore().upsertAuthorized` to wrap this helper with `withTransaction(client, tx => ...)`. The new EVE account service can call the helper from its own existing transaction without issuing nested `BEGIN` statements.

- [ ] **Step 6: Run focused character tests**

Run: `node --import tsx --test src/characters/store.test.ts src/characters/postgres-store.test.ts`

Expected: PASS; same-user/same-owner reauthorization still refreshes encrypted tokens, while cross-user and owner changes fail.

- [ ] **Step 7: Commit ownership hardening**

```bash
git add src/characters/store.ts src/characters/store.test.ts src/characters/postgres-store.test.ts
git commit -m "fix: prevent implicit EVE pilot transfers"
```

---

### Task 3: Resolve or Create an EVE Account Atomically

**Files:**
- Create: `src/auth/eve-account-auth.ts`
- Create: `src/auth/eve-account-auth.test.ts`

**Interfaces:**
- Consumes: `TransactionSource`, `AppUser`, `AuthorizedCharacterInput`, and `upsertPostgresAuthorizedCharacter` from Task 2.
- Produces: `EveAccountAuthService.complete(input): Promise<EveAccountAuthResult>` and typed `EveAccountAuthError` outcomes for route mapping.

- [ ] **Step 1: Define service behavior in failing tests**

Create a stateful fake PostgreSQL client and cover these complete inputs:

```ts
const input: EveAccountAuthInput = {
  characterId: 9001,
  characterName: 'Aura Example',
  ownerHash: 'owner-a',
  scopes: 'esi-assets.read_assets.v1',
  refreshToken: 'refresh-token',
  accessToken: 'access-token',
  accessTokenExpiresAt: Date.parse('2026-09-01T01:00:00Z'),
};
```

Required assertions:

- First completion returns `{ created: true, backfilled: false }`, creates an active email-null user, identity, pilot, and main-character value.
- With no existing non-deleted admin, the user role is `admin`; with one, it is `user`.
- Repeating the same character/owner returns the same user with `{ created: false, backfilled: false }` and refreshes pilot tokens.
- A matching legacy pilot without an identity returns its existing user with `{ created: false, backfilled: true }` and inserts the identity.
- An identity or legacy pilot with another owner hash rejects with `eve_owner_mismatch` and leaves all rows unchanged.
- A disabled/deleted resolved user rejects with `account_not_active`.
- An injected write error results in `ROLLBACK` and no partial user/identity/pilot state.
- The first query inside the transaction obtains `pg_advisory_xact_lock(characterId)` so concurrent first callbacks serialize.

- [ ] **Step 2: Run the service test and verify the missing-module failure**

Run: `node --import tsx --test src/auth/eve-account-auth.test.ts`

Expected: FAIL because `eve-account-auth.ts` does not exist.

- [ ] **Step 3: Add the public service contract and errors**

Create these exports in `src/auth/eve-account-auth.ts`:

```ts
export interface EveAccountAuthInput extends AuthorizedCharacterInput {}

export interface EveAccountAuthResult {
  user: AppUser;
  created: boolean;
  backfilled: boolean;
}

export type EveAccountAuthErrorCode =
  | 'account_not_active'
  | 'eve_owner_mismatch'
  | 'character_linked_elsewhere';

export class EveAccountAuthError extends Error {
  constructor(readonly code: EveAccountAuthErrorCode) {
    super(code);
    this.name = 'EveAccountAuthError';
  }
}

export interface EveAccountAuthService {
  complete(input: EveAccountAuthInput): Promise<EveAccountAuthResult>;
}

export function createEveAccountAuthService(
  source: TransactionSource = getPostgresPool(),
  options: { now?: () => Date; secretKey?: Buffer } = {},
): EveAccountAuthService
```

- [ ] **Step 4: Implement the serialized transaction**

Inside `complete`, call `withTransaction(source, async client => ...)` and execute this order:

```ts
await client.query('SELECT pg_advisory_xact_lock($1)', [input.characterId]);
const identity = await findIdentityWithUser(client, input.characterId);
if (identity) return completeExistingIdentity(client, identity, input, options);

const legacy = await findLegacyPilotWithUser(client, input.characterId);
if (legacy) return backfillLegacyIdentity(client, legacy, input, options);

return createAccountIdentityAndPilot(client, input, options);
```

Each identity/user lookup selects all `AppUser` fields needed by the existing model and locks the matching row. Exact branch rules:

- Compare owner hash before any write.
- Require `status === 'active'` before any pilot/token update.
- Existing identity: strict helper upsert, update `last_login_at`, and set main character only through `COALESCE(main_character_id, $2)`.
- Legacy pilot: require its stored owner hash to match, insert identity for its existing user, strict helper upsert, and set main with `COALESCE`.
- New account: select first-admin role with the same `EXISTS` query as password/Google creation, insert `app_users (email, role, created_at, updated_at)` with null email, insert identity, strict helper upsert, then set the main character.
- Translate `CharacterOwnershipError` and `CharacterOwnerMismatchError` to the public service codes without exposing owner hashes.

- [ ] **Step 5: Run the focused service tests**

Run: `node --import tsx --test src/auth/eve-account-auth.test.ts`

Expected: PASS for new, repeat, backfill, mismatch, disabled/deleted, concurrency-lock, and rollback behavior.

- [ ] **Step 6: Run migration and character regression tests together**

Run: `node --import tsx --test src/db/migrations.test.ts src/characters/store.test.ts src/characters/postgres-store.test.ts src/auth/eve-account-auth.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the account service**

```bash
git add src/auth/eve-account-auth.ts src/auth/eve-account-auth.test.ts
git commit -m "feat: resolve EVE-authenticated app accounts"
```

---

### Task 4: Share Session HTTP Primitives

**Files:**
- Create: `src/auth/session-http.ts`
- Create: `src/auth/session-http.test.ts`
- Modify: `src/auth/app-auth-routes.ts:1-15,70-80,108-116,137-190,330-380`
- Modify: `src/auth/app-auth-routes.test.ts`

**Interfaces:**
- Consumes: Fastify request/reply types and `SESSION_COOKIE`.
- Produces: `safeLocalReturnTo`, `sessionMetadataForRequest`, `setSessionCookie`, and `clearSessionCookie` shared by Google/password and EVE auth.

- [ ] **Step 1: Write failing helper tests**

Create `src/auth/session-http.test.ts` with table tests proving:

```ts
assert.equal(safeLocalReturnTo('/fits?mode=fits'), '/fits?mode=fits');
assert.equal(safeLocalReturnTo('https://evil.example'), '/');
assert.equal(safeLocalReturnTo('//evil.example'), '/');
assert.equal(safeLocalReturnTo('javascript:alert(1)'), '/');
```

Use a Fastify route with `@fastify/cookie` to assert `setSessionCookie` emits a signed, HTTP-only, SameSite=Lax, path `/` cookie with a 30-day max age, and that `secure: true` is honored. Assert `sessionMetadataForRequest` returns hashes rather than raw IP/user-agent values.

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --import tsx --test src/auth/session-http.test.ts`

Expected: FAIL because `session-http.ts` does not exist.

- [ ] **Step 3: Implement shared helpers**

Create `src/auth/session-http.ts` with these signatures:

```ts
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function safeLocalReturnTo(value: string | undefined): string;
export function sessionMetadataForRequest(req: FastifyRequest): SessionMetadata;
export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options?: { cookieName?: string; secure?: boolean },
): void;
export function clearSessionCookie(
  reply: FastifyReply,
  options?: { cookieName?: string; secure?: boolean },
): void;
```

`safeLocalReturnTo` accepts only values starting with `/` and not `//`. Metadata uses SHA-256 and returns null for missing values. Cookie defaults use `SESSION_COOKIE` and the current production-security rule.

- [ ] **Step 4: Refactor app auth routes to consume the helpers**

Remove the private duplicate cookie/local-return/hash functions from `app-auth-routes.ts`. Replace login and Google callback code with:

```ts
const issued = await sessions.create(user.id, sessionMetadataForRequest(req));
if (!issued) return reply.code(403).send({ error: 'account_not_active' });
setSessionCookie(reply, issued.token, { cookieName, secure: secureCookies });
```

Use the shared clear helper for logout and shared local-return sanitizer for Google OAuth state.

- [ ] **Step 5: Run helper and existing app-auth tests**

Run: `node --import tsx --test src/auth/session-http.test.ts src/auth/app-auth-routes.test.ts`

Expected: PASS with no observable password/Google/session behavior changes.

- [ ] **Step 6: Commit the shared primitives**

```bash
git add src/auth/session-http.ts src/auth/session-http.test.ts src/auth/app-auth-routes.ts src/auth/app-auth-routes.test.ts
git commit -m "refactor: share auth session HTTP helpers"
```

---

### Task 5: Add EVE Account OAuth Intent and Session Creation

**Files:**
- Modify: `src/auth/sso.ts:1-124`
- Modify: `src/auth/sso.test.ts`
- Modify: `src/server.ts:1-56`

**Interfaces:**
- Consumes: `EveAccountAuthService`, `SessionStore`, `UserStore.markActive`, strict `CharacterStore`, and Task 4 session helpers.
- Produces: `GET /auth/eve/start?intent=account|add_pilot`, backward-compatible `GET /auth/login`, and account-aware `GET /auth/callback`.

- [ ] **Step 1: Expand failing EVE route tests with injectable OAuth dependencies**

Add fake dependencies to `SsoRouteDeps` tests:

```ts
exchangeCode: async () => ({
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 1200,
  token_type: 'Bearer',
}),
verifyToken: async () => ({
  sub: 'CHARACTER:EVE:9001',
  name: 'Aura Example',
  owner: 'owner-a',
  scp: ['esi-assets.read_assets.v1'],
}),
```

Tests must assert:

- `/auth/eve/start?intent=account&returnTo=%2Ffits` works signed out and issues `{ provider: 'eve', intent: 'account', returnTo: '/fits' }`.
- An external return path is stored as `/`.
- `intent=add_pilot` requires a current user and stores its `userId`.
- `/auth/login` still starts signed-in add-pilot state.
- Account callback calls `eveAccounts.complete` with the verified identity and token fields, creates a session, sets the standard cookie, marks the user active, and redirects to the state return path.
- Account callback maps owner mismatch, inactive account, exchange failure, and verification failure to neutral `/?auth_error=<code>` redirects without sensitive values.
- Add-pilot callback still returns close-window HTML on success.
- Add-pilot ownership/owner-hash conflicts return a neutral failure and do not transfer the character.
- Invalid/replayed state is rejected before `exchangeCode` is called.

- [ ] **Step 2: Run the route tests and verify failure**

Run: `node --import tsx --test src/auth/sso.test.ts`

Expected: FAIL because the new route, dependencies, state intent, and account callback branch do not exist.

- [ ] **Step 3: Extend `SsoRouteDeps` and canonical start routing**

Add dependencies with production defaults:

```ts
export interface SsoRouteDeps {
  oauthStates?: OAuthStateStore;
  currentUser?: CurrentUserResolver;
  characters?: CharacterStore | AsyncCharacterStore;
  eveAccounts?: EveAccountAuthService;
  sessions?: SessionStore;
  users?: Pick<UserStore, 'markActive'>;
  exchangeCode?: typeof exchangeCode;
  verifyToken?: typeof verifyEveJwt;
  sessionCookieName?: string;
  secureCookies?: boolean;
}
```

Implement a shared start function. Account state contains no user ID; add-pilot state requires the current active user and includes it. Keep `/auth/login` as an alias that invokes add-pilot start behavior.

- [ ] **Step 4: Dispatch callback behavior from consumed state**

After state consumption and verified token parsing, construct exactly one `AuthorizedCharacterInput`. For `intent === 'account'`:

```ts
const result = await eveAccounts.complete(authorized);
const issued = await sessions.create(result.user.id, sessionMetadataForRequest(req));
if (!issued) return redirectAuthError(reply, 'account_not_active');
setSessionCookie(reply, issued.token, { cookieName, secure: secureCookies });
await users.markActive(result.user.id);
return reply.redirect(safeLocalReturnTo(stateMetadata.returnTo as string | undefined));
```

For `intent === 'add_pilot'`, require `userId`, call the strict character store, and return the existing close-window HTML. Reject unknown/missing intents and old invalid state safely. Error mapping must use stable codes only; never include exception messages containing EVE response bodies.

- [ ] **Step 5: Share production stores in `server.ts`**

Construct one pool-backed instance of each auth dependency and pass the same objects to both route registrars:

```ts
const userStore = createUserStore();
const sessionStore = createSessionStore();
const oauthStateStore = createOAuthStateStore();
const eveAccountAuth = createEveAccountAuthService();

registerAppAuthRoutes(app, {
  users: userStore,
  sessions: sessionStore,
  secureCookies: secureCookiesFromEnv(),
});
registerSsoRoutes(app, {
  characters: characterStore,
  users: userStore,
  sessions: sessionStore,
  oauthStates: oauthStateStore,
  eveAccounts: eveAccountAuth,
  secureCookies: secureCookiesFromEnv(),
});
```

- [ ] **Step 6: Run EVE and app-auth tests plus typecheck**

Run: `node --import tsx --test src/auth/sso.test.ts src/auth/app-auth-routes.test.ts src/auth/eve-account-auth.test.ts`

Run: `npm run typecheck`

Expected: both commands PASS.

- [ ] **Step 7: Commit OAuth and server integration**

```bash
git add src/auth/sso.ts src/auth/sso.test.ts src/server.ts
git commit -m "feat: authenticate app accounts with EVE"
```

---

### Task 6: Expose Continue with EVE in the Auth Gate

**Files:**
- Modify: `web/src/components/AuthGate.tsx:17-40,110-160`
- Modify: `src/auth/frontend-auth-view.test.ts`
- Create: `web/src/components/AuthGate.css`

**Interfaces:**
- Consumes: `GET /auth/eve/start?intent=account&returnTo=...` and callback `auth_error` codes from Task 5.
- Produces: signed-out **Continue with EVE** entry in both login/signup modes and safe user-facing EVE error labels.

- [ ] **Step 1: Write failing frontend source-view tests**

Add assertions to `src/auth/frontend-auth-view.test.ts`:

```ts
assert.match(authGate, /const eveStartUrl = useMemo/);
assert.match(authGate, /\/auth\/eve\/start/);
assert.match(authGate, /intent: 'account'/);
assert.match(authGate, />Continue with EVE</);
assert.match(authGate, /eve_owner_mismatch/);
assert.match(authGate, /eve_auth_failed/);
assert.match(authGateStyles, /\.eve-auth-button/);
```

At the top of the test, load the new stylesheet explicitly:

```ts
const authGateStyles = readFileSync(resolve('web/src/components/AuthGate.css'), 'utf8');
```

Retain all existing Google/password/reset and global-style assertions.

- [ ] **Step 2: Run the frontend auth test and verify failure**

Run: `node --import tsx --test src/auth/frontend-auth-view.test.ts`

Expected: FAIL because the EVE URL, button, labels, and style do not exist.

- [ ] **Step 3: Add the EVE start URL and provider action**

Derive one safe destination using the existing local-path logic, then build both provider URLs. The EVE URL must be:

```ts
const eveStartUrl = useMemo(() => `/auth/eve/start?${new URLSearchParams({
  intent: 'account',
  returnTo: destination,
}).toString()}`, [destination]);
```

Render this before the email/password forms:

```tsx
<div className="auth-provider-actions">
  <a className="eve-auth-button" href={eveStartUrl}>Continue with EVE</a>
  <a className="google-auth-button" href={googleStartUrl}>Continue with Google</a>
</div>
```

Refactor the existing destination calculation into a memoized value shared by Google and EVE so the two paths cannot diverge.

Import the isolated stylesheet from the component:

```ts
import './AuthGate.css';
```

- [ ] **Step 4: Map safe callback error codes**

Read `auth_error` from the current query string on initial render and pass it through `labelError`. Add labels:

```ts
case 'eve_owner_mismatch':
  return 'This EVE character no longer matches the account owner. Contact support to recover access.';
case 'character_linked_elsewhere':
  return 'This EVE character is already linked to another account.';
case 'eve_auth_failed':
  return 'EVE authentication could not be completed. Please try again.';
```

Do not render raw query values for unknown EVE errors; collapse any callback code not in the allowlist to the generic EVE message.

- [ ] **Step 5: Add scoped EVE provider styling**

Create `web/src/components/AuthGate.css`. Use `.auth-provider-actions` for vertical spacing and define both `.auth-provider-actions .google-auth-button` and `.eve-auth-button` with the existing provider-button dimensions. Give EVE a dark-blue treatment and preserve the current focus outline, hover contrast, and mobile width. Do not edit `web/src/styles.css`; it contains the user's unrelated fit work.

- [ ] **Step 6: Run frontend auth tests and build**

Run: `node --import tsx --test src/auth/frontend-auth-view.test.ts`

Run: `npm run build`

Expected: both PASS.

- [ ] **Step 7: Run the full regression suite**

Run: `npm test`

Run: `npm run test:pg`

Expected: unit suite PASS. PostgreSQL integration suite PASS when `DATABASE_URL`/`TEST_DATABASE_URL` are configured, or report its existing explicit skip when they are absent.

- [ ] **Step 8: Confirm only intended files are staged and commit UI**

Run: `git status --short`

Verify the pre-existing fit files remain modified but unstaged. Then:

```bash
git add web/src/components/AuthGate.tsx web/src/components/AuthGate.css src/auth/frontend-auth-view.test.ts
git commit -m "feat: add Continue with EVE account login"
```

---

## Final Verification Checklist

- [ ] `node --import tsx --test src/db/migrations.test.ts src/characters/store.test.ts src/characters/postgres-store.test.ts src/auth/eve-account-auth.test.ts src/auth/session-http.test.ts src/auth/app-auth-routes.test.ts src/auth/sso.test.ts src/auth/frontend-auth-view.test.ts` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm test` passes.
- [ ] `npm run test:pg` passes or performs only its documented environment-variable skips.
- [ ] `git status --short` shows the user's original fit-UI changes untouched and no unintended auth files.
- [ ] No diff contains raw token/state/owner-hash logging or a character conflict update that assigns `user_id = excluded.user_id`.
- [ ] Manual smoke test with configured EVE SSO: new character creates account/pilot/main pilot; repeat login returns to the same account; signed-in add-pilot still closes its popup.
