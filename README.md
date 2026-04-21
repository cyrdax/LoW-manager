# Legion of Wayne Manager (LoW-manager)

Self-hosted single-user web app to monitor a fleet of EVE Online characters you personally own, keep their status visible at a glance, and drive two of the most useful multibox operations from one place: **mass fleet invites** and **mass autopilot waypoints**. Built on CCP's ESI (EVE Swagger Interface).

Designed for ~6–20 alts. Scales comfortably further within ESI's rate limits.

---

## What it does

### Live status row per character

The dashboard is a sortable, resizable table with one row per authenticated character:

| Column    | Shown                                                                                    | ESI source (scope)                                              |
|-----------|------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| Select    | checkbox — drives which characters invite/waypoint actions target                        | (local)                                                         |
| Portrait  | 40 px character portrait                                                                 | `images.evetech.net` (no auth)                                  |
| Name      | character name, online dot, corp ticker + name, boss / in-fleet / needs-reauth pills     | `/characters/{id}/` (public) + `/corporations/{id}/` (public)   |
| Location  | current solar system, or station name if docked                                          | `location.read_location.v1`                                     |
| Ship      | ship type + ship name (Python-repr escapes decoded server-side)                          | `location.read_ship_type.v1`                                    |
| Wallet    | ISK balance, auto-formatted (K / M / B / T)                                              | `wallet.read_character_wallet.v1`                               |
| Training  | currently training skill + level + time remaining, or "Not training"                     | `skills.read_skillqueue.v1`                                     |
| SP        | total skillpoints, plus unallocated SP accent chip when > 0                              | `skills.read_skills.v1`                                         |
| Implants  | implant count (`N/10`), full list in hover tooltip                                       | `clones.read_implants.v1`                                       |
| Actions   | ★ set as fleet boss · × remove character                                                 | (local)                                                         |

Updates push to the browser via Server-Sent Events as polls complete. No client-side refresh polling.

### Row color coding

- **Boss** (designated via ★): navy-blue tint with a sky-blue accent bar on the left edge.
- **Has any "Virtue" implant**: green tint. (Explorer pods.)
- **Has implants but none are Virtue**: orange-red tint. Flags alts who need to jump-clone before a scan op.
- **Needs re-auth**: red border + "Needs re-auth" label. Usually means the refresh token was revoked on CCP's side or scopes changed.
- Boss tint composes with implant tint (teal = boss with Virtues, amber = boss with wrong pod).

### Sortable, resizable, persistent table

- Click any header (`Character`, `Location`, `Ship`, `Wallet`, `Training`, `SP`, `Implants`) to sort. Click again to reverse. Active column shows a small `▲`/`▼`.
- Drag the thin handle on the right edge of any header to resize.
- Selection state is in-memory; column widths and sort settings persist in `localStorage` (key `efd.table.v2`).
- **Header totals**: Wallet and SP columns show the sum across all characters right next to the label.

### Control panel (sidebar)

- **Add character** — opens a popup to CCP's SSO. Popup closes itself after login; the new character auto-selects.
- **Set waypoint on all clients** — type a system name (≥ 2 chars). Up to 3 live suggestions populate below. Arrow keys to navigate, Enter to confirm, Esc to dismiss. Selecting a system fires `POST /ui/autopilot/waypoint/` against every *currently-online selected* character (or all online characters when nothing is selected).
- **Fleet boss status** — shows whose row is starred, whether they're in a fleet, and their role. Invite is only enabled when the boss's role is `fleet_commander` (more on this below).
- **Invite selected (N)** — sends fleet invites to every selected, non-boss, non-reauth-needed alt. Reports per-character results (`invited`, `already in fleet`, `CSPA blocked`, specific ESI errors).

### Select-all + bulk actions

Checkbox at the top of the rows toggles every row at once. The "N/M" counter in the top-right shows how many are selected. Invite-all and waypoint actions act on the current selection only. New characters auto-select when added.

---

## Important ESI realities (useful background)

Several things players expect work differently or not at all through ESI. These shape how this app behaves:

- **ESI cannot create a fleet.** The boss has to press `Fleet → Create Fleet` in-client once. After that, this app does everything else.
- **ESI cannot populate the in-game buddy watchlist.** But once every alt is in the boss's fleet, the Photon UI **Fleet Watchlist** panel auto-populates in every client — same effect, no extra work.
- **ESI cannot accept invites.** You still click Accept on each client. Once a character joins, their row shows a green ✓ pill and the "Invite selected" button skips them next time.
- **ESI cannot post to chat or broadcast fleet commands.** Both were removed in 2018 / never existed. Don't waste time looking for them.
- **Fleet write endpoints require `fleet_commander` role, not just fleet ownership.** This is CCP's rule, not ours — a squad commander who owns the fleet will get a 404 on fleet-level calls. The sidebar nudges you to move to the Fleet Commander slot in-client when needed.
- **CSPA charges** set by a character block fleet invites to them; ESI returns 403 and the UI surfaces it per row.
- **ESI returns non-ASCII ship names as Python `repr()` strings** like `u'\u30e0 FantasticScans…'`. This app decodes them server-side so you see the real characters.

If you want a deeper cheat sheet, see `~/.claude/projects/-Users-cyrdax/memory/reference_eve_esi_capabilities.md` (created during development).

---

## Setup

### 1. Register a CCP developer application

1. Go to https://developers.eveonline.com/applications and create a new application.
2. **Connection type**: Authentication & API Access.
3. **Callback URL**: `http://localhost:3000/auth/callback`
4. **Scopes** — copy these exactly:
   - `esi-location.read_location.v1`
   - `esi-location.read_ship_type.v1`
   - `esi-location.read_online.v1`
   - `esi-wallet.read_character_wallet.v1`
   - `esi-skills.read_skillqueue.v1`
   - `esi-skills.read_skills.v1`
   - `esi-clones.read_implants.v1`
   - `esi-fleets.read_fleet.v1`
   - `esi-fleets.write_fleet.v1`
   - `esi-ui.write_waypoint.v1`
5. Save and copy the Client ID and Secret.

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:

| Variable             | Value                                                                    |
|----------------------|--------------------------------------------------------------------------|
| `EVE_CLIENT_ID`      | from the CCP dev app                                                     |
| `EVE_CLIENT_SECRET`  | from the CCP dev app (keep private)                                      |
| `EVE_CALLBACK_URL`   | `http://localhost:3000/auth/callback`                                    |
| `PORT`               | `3000` (change only if you have a conflict; also update the callback)    |
| `CONTACT_EMAIL`      | your email — sent to CCP as part of the User-Agent per ESI's best practice |
| `COOKIE_SECRET`      | any long random string                                                   |

### 3. Install & run

```bash
npm install
npm run dev
```

- Backend (Fastify + polling): http://localhost:3000
- Vite dev server (frontend): http://localhost:5173

Open http://localhost:5173. Click **Add character** once per alt.

For a single-port production-style run:

```bash
npm run build   # builds web/dist
npm start       # Fastify serves the built frontend on :3000
```

---

## Using it: a typical fleet-forming session

1. **First run**: add every alt via the SSO popup. They'll populate the table as their polls complete (a second or two each).
2. **Designate a boss**: click ★ next to the character you'll be flying as FC. The row turns blue.
3. **Form the fleet in-client**: on the boss character, open the Fleet menu → Create Fleet. The app's sidebar flips to green **"Fleet commander · fleet NNNNN"** within ~30 s (ESI cache).
4. **Invite selected**: hit the button. Each alt gets an in-client fleet invite popup. The app reports per-alt results.
5. **Tab through each client and click Accept**. Rows light up with green ✓ pills as alts join.
6. **Drive the group around**: use the "Set waypoint on all clients" search (type `jit`, Enter) to fan the autopilot out to every online alt.

### Keeping the boss in the Fleet Commander slot

If you move the boss into a squad mid-op, subsequent `Invite all` calls will fail with 404 — because `/fleets/{id}/*` endpoints are gated by role, not ownership. The sidebar will warn you when the boss's role is no longer `fleet_commander`; just drag them back to the FC slot, wait ~30s, and try again.

---

## Data, privacy, security

- Tokens (access + refresh) are stored in a local SQLite file at `data/app.db`. Anyone with that file can impersonate your characters within the scope set until you revoke the grants.
- To fully reset: stop the server, delete `data/app.db`, revoke third-party grants at <https://community.eveonline.com/support/third-party-applications/>, then re-authenticate.
- The server binds to `127.0.0.1` only — it's not reachable from other machines by default.
- `.env` is gitignored. If you accidentally commit a client secret, rotate it on CCP's developer portal.

---

## Architecture

```
[React + Vite dashboard]  ⇄  [Fastify backend]  ⇄  [EVE SSO / ESI]
       ↑ SSE push                │
                                 └── SQLite (tokens, corps, universe names)
```

Key pieces:

- `src/auth/` — SSO code flow, JWKS-based JWT verification, token refresh with automatic `needs_reauth` fallback.
- `src/esi/client.ts` — shared fetch wrapper that injects auth, tracks `X-Esi-Error-Limit-Remain`, backs off before hitting limits, and handles 204 responses without blowing up on empty bodies.
- `src/polling/scheduler.ts` — one task per character, fans out across per-endpoint timers (location: 5s, ship: 5s, online: 60s, wallet: 120s, SP: 120s, implants: 120s, fleet: 5s, corp: 3600s), emits diffs over an in-memory event bus.
- `src/routes/stream.ts` — SSE endpoint that pipes the event bus to the browser with heartbeats.
- `src/esi/universe.ts` — bootstraps an 8000+ solar-system cache on first boot via `POST /universe/names/`, backs the in-app waypoint autocomplete.
- `web/src/hooks/useTableState.ts` — sort + column-width state persisted to `localStorage`.

### Adding new ESI fields

Follow the pattern established in `scheduler.ts`:

1. Add the scope to `src/auth/scopes.ts` and re-auth every character (their old tokens don't retroactively gain new scopes).
2. Add an ESI wrapper in `src/esi/…`.
3. Add a new timer field + polling branch in the scheduler.
4. Extend `CharacterStatus` in `src/types.ts` and `web/src/api.ts`.
5. Render it in `CharacterCard.tsx` (and possibly add a sortable column in `App.tsx` + the CSS grid template).

Obvious candidates (all surveyed, none implemented yet): industry job ETAs, PI extractor timers, jump-clone cooldown, fatigue timer, unified notifications feed (low-fuel structure alerts), `POST /ui/openwindow/marketdetails/` to pop a market window on every client.

---

## Troubleshooting

| Symptom                                                                             | Likely cause                                                                                   |
|-------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `401 … is not valid for any required scope: …`                                      | Existing token predates a scope bump. Click **Add character** on that alt to re-auth.          |
| `Invite all` returns 404 for every row                                              | Boss isn't in the `fleet_commander` role. Drag them to the FC slot in-client; wait ~30s.       |
| `Fleet or character not found` on the ensure-squad step                             | Same — the token can't see fleet structure unless role = fleet_commander.                      |
| Every card shows the online dot as grey/unknown                                      | The character's online-status poll hasn't completed yet. Wait up to 60s for the first cycle.   |
| Ship name shows `u'\uXXXX …'`                                                        | Old cached value. Server-side decoder is applied on next ship poll (~5s after it changes).    |
| Card stays in "Needs re-auth" after re-adding                                        | CCP's token endpoint may be slow for a moment. Refresh the page, or check server logs for 401. |
| Localhost:5173 loads but API calls 404                                              | Backend isn't running. `npm run dev` starts both; check `concurrently` output.                 |

---

## Repo

https://github.com/cyrdax/LoW-manager
