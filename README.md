# Legion of Wayne Manager (LoW-manager)

Self-hosted single-user web app to monitor multiple EVE Online characters you own and auto-invite all of them to a fleet formed by one designated "boss" character. Built around CCP's ESI (EVE Swagger Interface).

## What it does

- **Dashboard grid** — one live card per authed character with:
  - Online status (green/red dot)
  - Wallet (ISK)
  - Location (solar system, station if docked)
  - Active ship (type + ship name)
  - Currently-training skill and time remaining
- **Control panel**:
  - Add a character via EVE SSO (opens a popup; closes itself after login)
  - Remove a character
  - Designate one character as the fleet boss
  - "Invite all to boss fleet" — sends fleet invites to every other authed character

## ESI quirks worth knowing

- **ESI cannot create a fleet.** The boss has to form a fleet in-client first. The UI nudges you when this is the case.
- **ESI cannot populate the classic in-game buddy watchlist.** But once every alt is in the same fleet, the Photon UI **Fleet Watchlist** panel auto-populates in every client — same effect, no API calls needed.
- Invites are real in-client popups; alts must accept them.
- If an alt has a CSPA charge configured, ESI refuses the invite and the UI surfaces the error.

## Setup

### 1. Register a CCP developer application

1. Go to <https://developers.eveonline.com/applications> and create an app.
2. **Connection type**: Authentication & API Access.
3. **Scopes** (copy exactly):
   - `esi-location.read_location.v1`
   - `esi-location.read_ship_type.v1`
   - `esi-location.read_online.v1`
   - `esi-wallet.read_character_wallet.v1`
   - `esi-skills.read_skillqueue.v1`
   - `esi-fleets.read_fleet.v1`
   - `esi-fleets.write_fleet.v1`
4. **Callback URL**: `http://localhost:3000/auth/callback`
5. Save and grab the Client ID / Secret.

### 2. Configure

```bash
cp .env.example .env
# Edit .env and fill in EVE_CLIENT_ID, EVE_CLIENT_SECRET, CONTACT_EMAIL.
```

### 3. Install and run

```bash
npm install
npm run dev
```

- Backend listens on `http://localhost:3000`.
- Vite dev server on `http://localhost:5173` (proxies `/api` and `/auth` to the backend).

Open <http://localhost:5173>. Click **Add character** for each alt. Once you've added them all, form a fleet in-game on the boss's character, then hit **Invite all**.

For a production-ish single-port run:

```bash
npm run build   # builds web/dist
npm start       # serves the built frontend from the Fastify process on :3000
```

## Notes

- Tokens are stored in a local SQLite file at `data/app.db`. Keep it to yourself — refresh tokens there grant ongoing access to your characters (within the scope set).
- To rotate everything: delete `data/app.db`, revoke grants at <https://community.eveonline.com/support/third-party-applications/>, and re-authenticate.
- Polling respects ESI's `Expires` headers and the `X-Esi-Error-Limit-Remain` counter. For 6–20 characters this stays comfortably under rate limits.

## Extending later

- Add `esi-universe.read_structures.v1` to `src/auth/scopes.ts` and flesh out `resolveStructure` in `src/esi/universe.ts` to show player-structure names instead of IDs.
- `src/esi/` is the natural place to add more endpoints (autopilot waypoint, mail, etc.). Scheduler fields in `src/polling/scheduler.ts` use a consistent pattern — add a new field and timer alongside the existing ones.
