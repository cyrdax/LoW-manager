# Multi-Tenant App Design

## Goal

Refactor the app from a single-user local dashboard into a hosted multi-tenant EVE app. Users create app accounts, log in with email/password or Google, link their own EVE pilots, and use the existing features in parallel without seeing another user's private pilot data.

## Core Decisions

- Tenant model is individual app user accounts for v1. Organizations/workspaces and corp sharing are future features.
- Email/password login and Google login are both in scope for the auth foundation.
- Email/password accounts require email verification.
- Password reset by email is in scope for v1.
- Resend is the v1 email provider.
- Railway is the v1 deployment target.
- Mutable app data moves from SQLite to Postgres with a hard cutover.
- Static/bundled SDE data remains local JSON/files.
- A one-time SQLite import script migrates current local data into the first admin account.
- First registered account becomes admin when no admin exists.
- Current local data imported for the owner becomes admin-owned.
- Users self-register freely for v1.
- Future admin settings may restrict signup by invite, corporation, or alliance.

## Account Model

Users authenticate to the app first. EVE pilot authorization happens only after app login and is attached to the logged-in app user.

Supported app login methods:

- Email/password.
- Google OAuth/OIDC.

Account requirements:

- Email addresses are stored lowercase and unique.
- Passwords are hashed with a strong password hash. Passwords are never encrypted or stored raw.
- Google accounts are linked by stable Google subject ID.
- A user may have both email/password and Google login linked to the same app account when their verified email matches.
- Sessions use secure HTTP-only cookies backed by server-side session records.
- Sessions last 30 days by default.
- Logout revokes the current session.
- Admins can disable accounts, revoke sessions, and promote/demote admins.

## Main Pilot Identity

There is no separate freeform display name for v1.

Each user must choose a main EVE pilot. The main pilot provides:

- Display name.
- Display avatar.
- Public fit/doctrine attribution.

Users can create/log into an app account before linking pilots, but the main app dashboard is gated until the user links at least one pilot and chooses a main pilot.

If a main pilot is unlinked, the app prompts the user to select a new main pilot before entering the dashboard again.

## EVE Pilot Ownership

Each EVE pilot can belong to only one app user account at a time.

If another user tries to authorize an already-owned EVE pilot, the app rejects the link and tells them the pilot is already linked to another account. Admins can revoke or transfer ownership manually later if needed.

EVE refresh tokens are encrypted at rest with a server-side secret. Short-lived access tokens should either be encrypted at rest or kept in memory with expiration metadata; raw tokens must never appear in logs or audit events.

## Private Data

All data directly related to a user's EVE pilots is private to that user.

Private examples:

- Authorized pilots and EVE tokens.
- Pilot online/location/ship/wallet/skill/implant/PI/fleet status.
- Fleet boss selection and fleet actions.
- Saved skill plans.
- Private fits and doctrines.
- Any user-specific cached ESI data.

Fleet actions only see and operate on the logged-in user's own pilots in v1.

## Global Public Data

Public data remains shared across users.

Global examples:

- Bundled SDE/static data.
- Universe/system/station/name cache.
- Corporation name/ticker cache.
- Market pricing cache.
- Public contracts index and its warm region crawler.
- Public ESI-derived data that is not tied to an authenticated pilot.

The public contracts index remains global so users benefit from a single warmed cache rather than causing duplicate ESI crawls.

## Fits And Doctrines Visibility

Fits and doctrines support visibility:

- `private`: visible only to the owner.
- `public`: visible to all logged-in app users.
- `archived`: hidden from normal lists, retained for moderation/audit or account deletion preservation.

Fits UI gains a selector for private/public library mode. Doctrine UI follows the same visibility model.

Users can:

- Create private fits/doctrines.
- Create public fits/doctrines.
- Make their private fits/doctrines public.
- Copy public fits into their private library.
- Copy public doctrines into their private library.

Editing rules:

- Original owner can edit/delete their public item.
- Admins can edit, hide, or delete public items.
- Other users cannot edit public items directly.
- Other users can save/copy public items into their private library.

Public attribution:

- Public fits/doctrines show creator main pilot name and portrait.
- Emails are never shown in public listings.
- If the creator has no main pilot, attribution falls back to "Unknown pilot".

Public doctrine membership:

- Public doctrines may only contain public fits.
- When publishing a private doctrine that contains private fits, the UI must require the user to publish the needed member fits or copy them into public entries owned by that user.
- Copying a public doctrine into a user's private library creates a private doctrine and private copies of the member fits, so the user can customize the doctrine without mutating the public source.

## Admin Dashboard

Admin v1 includes:

- List users.
- View linked pilots per user.
- Disable/enable accounts.
- Revoke user sessions.
- Revoke/unlink pilots.
- Promote/demote admins.
- View audit events.
- Hide/archive public fits and doctrines.
- Transfer ownership of public fits/doctrines when needed.

Admin actions must be audit logged.

## Account Deletion

When a user deletes their account:

- Delete private pilot tokens.
- Delete private pilot-derived data.
- Delete private fits and doctrines.
- Keep public fits/doctrines and transfer them to admin ownership.
- Keep anonymized audit/security events.

## Audit Logging

Audit log these events:

- Account signup.
- Login/logout.
- Failed login.
- Email verification requested/completed.
- Password reset requested/completed.
- Google account linked/unlinked.
- EVE pilot linked/unlinked.
- Main pilot changed.
- Admin account disable/enable.
- Admin session revoke.
- Admin pilot revoke.
- Admin role changes.
- Fit/doctrine visibility changes.
- Public fit/doctrine moderation changes.
- Account deletion.

Never log raw passwords, password hashes, EVE refresh tokens, EVE access tokens, Google tokens, or full reset/verification token values.

## Background Polling

Private pilot ESI polling should run only for recently active users plus on-demand refresh when a user opens the app.

V1 recent activity rule:

- Mark a user active when they load the dashboard or hit authenticated API routes.
- Poll pilots for users active within the last 30 minutes.
- Stop polling inactive users.
- Refresh current user's pilots on dashboard open.

This keeps Railway cost and ESI load down while still making the app feel live.

## Local Development

Local dev uses Postgres, not SQLite, after the cutover.

Dev fallbacks:

- Email verification/reset links are printed to logs when `EMAIL_MODE=dev`.
- Google OAuth is disabled unless Google env vars are configured.
- EVE SSO remains required for pilot authorization.

## Deployment

Railway v1 services:

- Node/Fastify app service.
- Railway Postgres database.

Required secrets:

- `DATABASE_URL`
- `COOKIE_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `APP_BASE_URL`
- `EVE_CLIENT_ID`
- `EVE_CLIENT_SECRET`
- `EVE_CALLBACK_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`

## Out Of Scope For V1

- Organizations/workspaces.
- Corp/alliance-only access enforcement.
- Shared corp fleet operations.
- Billing/subscriptions.
- SSO for corporations.
- User-to-user fit collaboration.
- Public internet access to public fits/doctrines without login.
- User comments/ratings on public fits/doctrines.
- Automated moderation.

## Acceptance Criteria

- A new user can sign up with email/password, verify email, log in, authorize an EVE pilot, choose a main pilot, and use the dashboard.
- A new user can sign in with Google, authorize an EVE pilot, choose a main pilot, and use the dashboard.
- User A cannot see User B's private pilots, private pilot status, private fits, private doctrines, or saved skill plans.
- Public contract search still uses one shared warm index.
- Public fits/doctrines are visible to all logged-in users.
- Users can copy public fits/doctrines into private libraries.
- Current local SQLite data can be imported into the first admin account.
- All tests pass against Postgres-backed app data.
- The app deploys to Railway with Postgres and secure env-driven configuration.
