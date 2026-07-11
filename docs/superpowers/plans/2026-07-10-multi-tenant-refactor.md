# Multi-Tenant Refactor Implementation Plan

## Goal

Make the app safe to host for multiple EVE users. Every private route and store must operate through an authenticated app user. Public caches remain shared. The app must pass tests and run locally after each phase.

## Recommended Stack Changes

Add dependencies:

- `pg` for Postgres.
- `@types/pg` for TypeScript.
- `@node-rs/argon2` for password hashing.

Use existing dependencies where possible:

- `fastify` for routes.
- `@fastify/cookie` for secure session cookies.
- `jose` for JWT/OIDC verification.
- Native `fetch` for Resend and OAuth token calls.

Do not add an ORM in v1. The current codebase is store/repository oriented and will stay easier to migrate with explicit SQL.

## Phase 0: Branch, Baseline, And Local Postgres

Deliverables:

- Feature branch for multi-tenant work.
- `docker-compose.yml` or documented local Postgres startup command.
- `.env.example` updated for Postgres, auth, email, Google, EVE, and Railway variables.
- Baseline test/build result recorded.

Verification:

- `npm test -- --test-concurrency=1`
- `npm run build`

Commit:

- `chore: prepare multi tenant development`

## Phase 1: Postgres Foundation

Deliverables:

- `src/db/postgres.ts` connection pool.
- `src/db/migrations.ts` migration runner.
- SQL migration files for global cache tables and current app tables.
- Replace `src/db.ts` SQLite startup with Postgres-backed startup.
- Convert current stores/routes one area at a time to async Postgres queries.
- Keep public contract index global.
- Keep bundled SDE/static data unchanged.

Implementation notes:

- Current `better-sqlite3` calls are synchronous. Postgres stores become async.
- Fastify handlers already support async, so route conversion is straightforward but broad.
- Tests need a Postgres test helper that truncates tables between tests or provisions a test schema per file.
- Contract index refresh code must not run migrations per request.

Verification:

- Existing feature tests pass against Postgres.
- App starts locally with Postgres.
- Existing single-user behavior still works before auth gates are added.

Commit:

- `feat: migrate app data to postgres`

## Phase 2: App Auth Foundation

Deliverables:

- User, credential, Google account, session, auth token, and audit stores.
- Email/password signup.
- Email verification.
- Password reset.
- Login/logout/session APIs.
- Google OAuth login.
- Dev email mode that logs verification/reset links.
- Authenticated current-user endpoint.
- React login/signup/verify/reset screens.
- App shell gates dashboard behind login.

Routes:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/email/verify/request`
- `GET /auth/email/verify`
- `POST /api/auth/password/reset/request`
- `POST /api/auth/password/reset/complete`
- `GET /auth/google/login`
- `GET /auth/google/callback`

Security:

- Session cookie is HTTP-only, same-site lax, secure in production.
- Session token is random and stored as a hash in DB.
- Failed login attempts are audit logged.
- Disabled users cannot create sessions.

Verification:

- Signup requires email verification before dashboard access.
- Password reset works in dev email mode.
- Google login creates or links a user.
- Session survives refresh and expires/revokes correctly.

Commit:

- `feat: add app authentication`

## Phase 3: EVE Pilot Linking Under Users

Deliverables:

- EVE SSO route requires an authenticated app session.
- OAuth state stores purpose and user ID.
- EVE callback links pilot to current user.
- A pilot can only belong to one user.
- Refresh/access tokens are encrypted at rest.
- Current user can unlink their own pilots.
- User must select a main pilot before entering dashboard.
- Main pilot drives display name/avatar.

Route changes:

- `/auth/login` becomes an EVE pilot-link route, such as `/auth/eve/login`.
- Add a clear app login route separate from EVE SSO.
- Existing "Add character" button links EVE pilots for the current app user.

Verification:

- Logged-out users cannot start EVE SSO.
- User A cannot link a pilot already owned by User B.
- Main pilot gate appears after first pilot link.
- Dashboard shows only current user's pilots.

Commit:

- `feat: scope eve pilots to users`

## Phase 4: Private Data Scoping

Deliverables:

- Every private API route receives `currentUser`.
- Character status snapshot and polling are scoped by `user_id`.
- Fleet boss selection is per user.
- Skill plans are per user.
- Private fits and doctrines are per user.
- Market shopping-list send-to-pilot only lists current user's pilots.
- Polling scheduler only polls pilots for recently active users.

Routes to audit:

- `/api/characters`
- `/api/boss`
- `/api/fleet/*`
- `/api/autopilot/*`
- `/api/planets/*`
- `/api/skills/*`
- `/api/fits/*`
- `/api/doctrines/*`
- Any route that accepts `characterId`

Rule:

- If a route accepts `characterId`, it must verify that character belongs to `currentUser` unless the route explicitly handles public data.

Verification:

- User A cannot access User B pilots by direct API calls.
- User A cannot mutate User B saved fits/doctrines/skill plans.
- Public contract search still works without duplicating indexes.
- Recently active polling works and inactive users stop polling.

Commit:

- `feat: scope private data by user`

## Phase 5: Public/Private Fits And Doctrines

Deliverables:

- `visibility` support for fits and doctrines.
- Fits UI private/public selector.
- Doctrine UI private/public selector.
- Create fit/doctrine with selected visibility.
- Make private fit public.
- Make private doctrine public, with member-fit validation.
- Copy public fit into private library.
- Copy public doctrine into private library with private copies of member fits.
- Public listings show creator main pilot name and portrait.
- Public edit/delete restricted to owner/admin.

API additions:

- `GET /api/fits?visibility=private|public`
- `POST /api/fits/:id/publish`
- `POST /api/fits/:id/copy-private`
- `GET /api/doctrines?visibility=private|public`
- `POST /api/doctrines/:id/publish`
- `POST /api/doctrines/:id/copy-private`

Verification:

- User B can see User A public fit but cannot edit it.
- User B can copy User A public fit privately.
- User B can copy User A public doctrine privately.
- Public doctrine cannot expose private member fits.

Commit:

- `feat: add public fit and doctrine libraries`

## Phase 6: Admin Dashboard And Account Deletion

Deliverables:

- Admin route guard.
- Admin dashboard view.
- User list.
- Linked pilot list per user.
- Disable/enable users.
- Revoke sessions.
- Unlink pilots.
- Promote/demote admins.
- Hide/archive public fits and doctrines.
- Account deletion flow.
- Audit event list.

Verification:

- Non-admins cannot hit admin APIs.
- Disabled users cannot log in or use existing sessions.
- Account deletion removes private data and transfers public library ownership to an admin.
- Audit log records all admin/security actions without secrets.

Commit:

- `feat: add multi tenant admin controls`

## Phase 7: SQLite Import Script

Deliverables:

- `scripts/import-sqlite-to-postgres.ts`
- Import current local SQLite data into first admin account.
- Dry-run mode prints counts.
- Import mode inserts data transactionally.
- Token encryption is applied during import.
- Idempotency guard prevents duplicate imports.

Inputs:

- `SQLITE_DB_PATH`
- `DATABASE_URL`
- `ADMIN_EMAIL`

Verification:

- Dry run shows counts for characters, fits, doctrines, skill plans, and global caches.
- Import creates admin user if missing.
- Imported pilots/fits/doctrines appear under admin account.
- Existing contract index/global caches remain usable.

Commit:

- `feat: import sqlite data into postgres`

## Phase 8: Railway Deployment Hardening

Deliverables:

- Railway-ready start/build scripts.
- Healthcheck endpoint.
- Production cookie/security settings.
- Railway environment variable documentation.
- Resend production email configuration.
- Google OAuth callback documentation.
- EVE callback documentation.
- Migration-on-start safety.
- Basic backup/restore notes.

Verification:

- Production build works.
- App starts with `DATABASE_URL`.
- Healthcheck returns success.
- Railway deploy can create account, verify email, link EVE pilot, and load dashboard.

Commit:

- `chore: prepare railway deployment`

## Cross-Phase Test Strategy

Backend:

- Auth store tests.
- Session cookie tests.
- Google callback tests with mocked token/JWKS responses.
- Email verification/reset tests with dev mailer.
- EVE linking tests with mocked token exchange/JWT verification.
- Ownership tests for every private route.
- Public/private fits/doctrines tests.
- Admin route guard tests.
- Account deletion tests.
- SQLite import tests using fixture SQLite DB.

Frontend:

- Structural tests for login/main-pilot gates.
- Structural tests for private/public library controls.
- Component-level smoke checks through existing build/typecheck.

Manual smoke after each phase:

- Create user.
- Log in.
- Link pilot.
- Use dashboard.
- Save fit.
- Use contract search.
- Log out.

## Migration Risks

- Broad sync-to-async conversion can create subtle missed `await` bugs.
- Polling currently assumes global characters; this must be untangled carefully.
- Any route accepting `characterId` is a potential cross-user data leak if not guarded.
- Public doctrine publishing can accidentally expose private fits if invariant is missed.
- Token encryption key rotation is out of scope for v1 but should be documented before production.

## Stop/Go Gates

Do not start the next phase unless:

- Current phase tests pass.
- `npm run build` passes.
- App starts locally.
- No known cross-user leak exists in touched routes.
- Changes are committed.

## First Implementation Target

Start with Phase 0 and Phase 1 only. After Postgres is the runtime database and the current single-user app works against Postgres, continue to app auth. This keeps the riskiest storage cutover separate from user-facing auth behavior.
