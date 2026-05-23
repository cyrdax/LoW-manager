# Legion of Wayne Manager (LoW-manager)

Self-hosted single-user web app to monitor a fleet of EVE Online characters you personally own, keep their status visible at a glance, and drive multibox operations from one place: **mass fleet invites**, **mass autopilot waypoints**, and **planetary-interaction monitoring**. Built on CCP's ESI (EVE Swagger Interface).

Designed for ~6–20 alts. Scales comfortably further within ESI's rate limits.

The dashboard has five top-level views, toggled in the sidebar (selection persists in `localStorage.efd.view`):

- **Pilots** — the per-character status table (location, ship, wallet, training, etc.) plus fleet-boss controls and waypoint search.
- **Planets** — PI dashboard: per-pilot colony health, system scout search, saved systems, per-colony pin drill-down, and fleet-wide inventory roll-up.
- **Skills** — pilot picker + ship/module search; resolves Mastery I–V skill plans with SP-gap math from a bundled SDE-derived map, plus per-pilot saved plan bookmarks.
- **Fleet** — full FC-roster view with drag-and-drop wing/squad reassignment. Any authed pilot can be picked as the actor token (so you can drive moves under whichever alt holds the FC role).
- **Market** — two sub-tabs: **PLEX** (price chart, sell-side calculator with sales-tax / broker fee math) and **Shopping List** (paste a multi-item buy order, get a per-item + total cost quote in Jita or Amarr, walking the order book).

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
- **Skill queue under 10 days remaining** (or empty): thick red outline around the row, regardless of other tints. Prompt to top up the queue before the character goes idle.
- Boss tint composes with implant tint (teal = boss with Virtues, amber = boss with wrong pod); the red queue outline composes with any of them.
- **AU-79 is ignored by the tint logic.** It's a cosmetic/special implant, so a pod containing only AU-79 counts as "no implants" for coloration. It still shows up in the `N/10` count and the hover tooltip.

### Sortable, resizable, persistent table

- Click any header (`Character`, `Location`, `Ship`, `Wallet`, `Training`, `SP`, `Implants`) to sort. Click again to reverse. Active column shows a small `▲`/`▼`.
- Drag the thin handle on the right edge of any header to resize.
- Selection state is in-memory; column widths and sort settings persist in `localStorage` (key `efd.table.v2`).
- **Header totals**: Wallet and SP columns show the sum across all characters right next to the label.

### Control panel (sidebar)

- **Add character** — opens a popup to CCP's SSO. Popup closes itself after login; the new character auto-selects.
- **Set waypoint on all clients** — type a system name (≥ 2 chars). Up to 3 live suggestions populate below. Arrow keys to navigate, Enter to confirm, Esc to dismiss. Selecting a system fires `POST /ui/autopilot/waypoint/` against every *currently-online selected* character (or all online characters when nothing is selected).
- **Fleet boss status** — shows whose row is starred, whether they're in a fleet, and their role. Invite is only enabled when the boss's role is `fleet_commander` (more on this below).
- **Invite / move target dropdown** — two sources of wing/squad options:
  - *From FC token (authoritative)*: when the boss is fleet_commander, we read `GET /fleets/{id}/wings/` and list every `Wing Name / Squad Name` on the fleet, plus an "Auto (first wing with a squad)" default.
  - *Known via your pilots*: when the FC read isn't available or doesn't cover a squad, we aggregate each authed pilot's own `wing_id`/`squad_id` from `/characters/{id}/fleet/` and list those too, with an occupant count. Names aren't available via this path (ESI doesn't expose them to non-FC tokens), so entries read as `Wing <id> / Squad <id>  (N of yours here)`.
  - If the fleet has just been formed and neither source has data yet, the sidebar shows an amber "waiting for ESI" notice with a **Check now** button. The structure poll re-tries every 2.5 s automatically.
- **Invite selected (N)** — sends fleet invites via the boss's token into the target chosen above (never auto-creates wings or squads — that used to silently land everyone in the wrong place). Reports per-character results (`invited`, `already in fleet`, `CSPA blocked`, specific ESI errors).
- **Move selected to target (N)** — reassigns selected pilots who are already in *some* fleet to the chosen wing/squad. Uses each pilot's **own** write-fleet token for the PUT call, mirroring the in-client free-move rule. Boss doesn't need to be involved or be fleet_commander for this to work; if the fleet doesn't have free-move, ESI returns the appropriate error per row.

### Select-all + bulk actions

Checkbox at the top of the rows toggles every row at once. The "N/M" counter in the top-right shows how many are selected. Invite-all and waypoint actions act on the current selection only. New characters auto-select when added.

---

## Planets view

PI is read-only via ESI (you can't run extractor restarts or install schematics from outside the client), but it exposes enough state for the actually-painful parts of multibox PI: tracking which extractors are about to expire, which alts are sitting on stockpiles, and scouting new systems for resource layouts.

### Pilot table (PI dashboard)

One row per character, sortable by Character / Colonies (count/max) / Next expiry / Status:

- **Colonies count/max** — `colonies.length / (1 + Interplanetary Consolidation level)`. With IPC V → 6 colonies. Underutilized rows (less than max) are highlighted amber so you can spot pilots with unbuilt colony slots.
- **Next expiry** — earliest extractor expiry across all of that pilot's colonies.
- **Status pill** — `IDLE` (red, any extractor cycle expired), `expiring soon` (amber, < 6 h), `healthy` (green), or `no colonies` (dim).
- **Click a character row** to drill into their colonies. Each colony row shows planet type, system, CC level, pin count, soonest expiry. **Click a colony row** to expand its full pin breakdown:
  - **Extractors** — product name, time-until-expiry countdown, cycle minutes, idle highlight.
  - **Factories** — resolved schematic name + facility tier (Basic / Advanced / High-Tech).
  - **Storage / Launchpads / Command Centers** — contents tagged P0 / P1 / P2 / P3+ with amounts.

Status header totals show colony count and idle count across the whole fleet.

### System scout search

Type a system name at the top of the Planets view (≥ 2 chars). Pick from autocomplete and the result block shows:

- System header with security status and a **★ save** button.
- Type-summary chips (`Temperate 2 · Barren 1 · Lava 4 · …`).
- A row per planet with the planet's name, its type tag, the **5 P0 → P1 extractables** for that type rendered inline, and any of *your* colonies sitting on that planet (character, CC level, pin count, expiry, idle badge).

Useful for scouting wormholes or low-sec systems before setting up a new colony — you can see at a glance whether a system has the planet types you need without alt-tabbing into the in-game map.

### Saved systems

Click the **★** in any system result header to save the system. The "Saved systems" panel above the search renders each save as a full system block (same layout as a live search result). Saves persist in `data/app.db` (`saved_systems` table).

### Fleet PI inventory roll-up

Collapsible panel above the pilot table. Click ▸ to load (or **↻** to refresh): walks every cached pin's `contents` across every pilot, sums by commodity, and groups by tier (P0 / P1 / P2 / P3+). Header shows totals per tier, and the body lists every commodity with its amount and how many planets it's stockpiled across. Filter buttons restrict to a single tier.

This is the answer to "do I need a hauler run?" without checking 14 in-client PI windows.

---

## Skills view

Targeted skill planning across all your alts without leaving the dashboard.

### Ship Mastery plans

1. **Pick a pilot** from the row of character chips at the top.
2. **Search a ship** (≥ 2 chars) and select it from the suggestions.
3. **Pick Mastery level I–V**. The view resolves the EVE Mastery certificate chain server-side and lists every prerequisite skill with:
   - current level (and SP) on the active pilot,
   - target level for that mastery,
   - SP gap (or ✓ if already met),
   - which certificate(s) require the skill.
4. **Save plan** with the ★ button — saved plans (per pilot) populate a quick-load bar above the search so you can compare progress across alts at a glance.

The math is pure-server: `src/skills/mastery-data.ts` is a compact SDE-derived JSON (rebuilt by `scripts/build-mastery-data.ts`), and the route at `/api/skills/plan` joins it against the pilot's `read_skills.v1` snapshot.

### Module / item plans

The "Item" search resolves any inventory item (modules, ammo, charges, drones, deployables) to its `requiredSkills` list and shows the same per-pilot gap analysis. Useful for "can I fly this module on this alt?" without alt-tabbing.

### Info / Market window buttons

Each plan row has compact buttons to open the in-game **Info** or **Market** window on the active pilot's client via `POST /ui/openwindow/marketdetails/` (requires `esi-ui.open_window.v1`). If the buttons 403, the pilot's token predates that scope — re-auth fixes it.

### SDE staleness

The view shows a yellow banner when CCP has published a newer EVE Static Data Export than the bundled `mastery-data.ts` was built against. Run `npm run build:mastery` to rebuild from the fresh SDE.

---

## Fleet view

Drag-and-drop control over the active fleet's full wing → squad → member tree.

### Actor token picker

Some operations need the FC token (e.g. reading the full roster, moving members across squads when free-move is off). The Fleet view lets you pick *any* of your authed pilots as the **actor** — so even if the boss row isn't your current FC, you can drive the view under whoever holds the role. The pilot picker defaults to the designated boss (`is_boss`) and falls back gracefully if the picked actor isn't actually in a fleet.

### Roster tree + drag-and-drop

- Wings render as collapsible cards with their squads nested inside, members listed under each squad.
- Each row shows character + ship + system, resolved server-side via the existing universe-name caches.
- **Drag a member** onto a different squad to move them. **Drag a squad or wing header** to bulk-move every member inside it to the target.
- A per-row × button kicks via `DELETE /fleets/{id}/members/{id}/`.
- Auto-refreshes every 10 s so kicks / accepts from other clients show up without manual reload.

### Endpoints

- `GET /api/fleet/roster?actor=<id>` — full wing→squad→member tree under the chosen actor's token. Character/ship/system names pre-resolved.
- `POST /api/fleet/move` and `POST /api/fleet/kick` — both accept an optional `actor_character_id` so the Fleet view can drive operations under any authed alt's token (the Pilots-view sidebar still uses the boss's token by default).

---

## Market view

Two sub-tabs, toggled at the top of the view (selection persists in `localStorage.efd.market.tab`):

### PLEX tab

A live tracker for PLEX prices on the Global PLEX Market region (19000001 — *not* The Forge; CCP unified the PLEX market into its own region in 2017).

- **Stats strip** — best ask, best bid, spread (% of bid), day Δ, range Δ, last-day volume + order count.
- **Range buttons** — 7D / 30D / 90D / 1Y / ALL (persist in `localStorage.efd.market.range`).
- **Price chart** — hand-rolled SVG. Daily average as a line, high-low band, daily volume as bars below, hover crosshair with a tooltip showing avg / high / low / volume / orders for that day.
- **Sell calculator** — quantity × price with the *real* EVE fee math:
  - Sales tax = `8% × (1 − 0.11 × Accounting level)` (3.6% at V)
  - Broker's fee = `3% − 0.3% × Broker Relations level` (1.5% at V)
  - Mode toggle: **Instant** (sell into best buy — no broker fee) vs **List** (sell order at best ask — broker fee up front, sales tax on fill)
  - Solve-for toggle: **Quantity → ISK** (forward: how much do I net?) or **Target ISK → PLEX** (reverse: how many PLEX do I need to sell to hit a target net amount?). Target mode ceilings the qty to a whole PLEX and reports the small overshoot.
  - Price source toggle: **auto** (best buy / best sell depending on mode) vs **manual** override.
  - Outputs: gross, broker fee, sales tax, net ISK, effective per-PLEX. In Target mode the "PLEX to sell" line becomes the headline.
  - All inputs persist in `localStorage.efd.market.calc`.

### Shopping List tab

Paste a multi-item buy list and get an honest cost estimate by walking the cheapest sell orders in the chosen hub.

**Input format** — one item per line, qty first:

```
2 Cap Recharger II
4 Multispectrum Energized Membrane II
2880 Arch Angel EMP XL
1 Domination Heavy Warp Disruptor
```

The parser also accepts `2x Cap Recharger II` and EVE's tab-separated in-game copy format (`Cap Recharger II\t2`). Repeated names are de-duplicated by summing their quantities.

**Hub picker** — Jita or Amarr only. Pricing is **in-system**: only sell orders sitting in stations / structures inside the chosen hub system are considered. So "Jita" really means Jita 4-4 and the other Jita stations, not the whole Forge region — which is what you'd actually pay if you flew to Jita to buy.

**Pricing math** — for each item, the server fetches the region's sell orders for that type, filters to the hub system, sorts ascending by price, and **walks the order book**: takes from the cheapest stack first, then the next, until the requested qty is filled. The reported `Subtotal` is the actual ISK you'd pay; `Avg price` is `Subtotal / filledQty`. If supply runs out before the requested qty is reached, the row is flagged **partial** and the shortfall (`−N`) is shown.

**Status pills**:

| Pill          | Meaning                                                                                        |
|---------------|------------------------------------------------------------------------------------------------|
| `ok`          | Full qty filled at hub.                                                                        |
| `partial fill` | Sell side ran out before qty was filled. Subtotal reflects what *did* fill; shortfall shown.   |
| `no sellers`  | Item resolved to a type_id but no sell orders in the hub system right now. Try the other hub.  |
| `unknown item` | Name didn't resolve via `POST /universe/ids/`. Check spelling against the in-game item exactly. |

**Endpoint** — `POST /api/market/shopping-list/quote` with `{ hub: "jita" | "amarr", items: [{ name, qty }] }`. Per-item orders requests run with concurrency 8 to stay polite on ESI's error budget. Name → type_id results are cached forever (type names don't change); orders are cached 5 minutes (matches ESI's own cache).

**Send to pilot (EVEmail)** — once a quote is calculated, a dropdown of authed pilots + a **Send as EVEmail** button appears above the results table. Pick the alt that's actually going to buy the items and hit Send. The server re-prices the list at send-time (in case prices shifted), then posts an EVEmail to that pilot via `POST /characters/{id}/mail/`. The mail body renders each item as `<a href="showinfo:TYPE_ID">Item Name</a>` — clickable in-game links that open the showinfo window, which has a "View Market Details" button. Effectively a navigable in-game shopping list.

Requires `esi-mail.send_mail.v1` (added in this scope set; existing pilots must re-auth). If the pilot's token predates the scope, the Send button surfaces a 401 with a "needs re-auth" hint. The mail is a self-mail (the chosen pilot is both sender and recipient — lands in their personal mail tab as From: themself). The endpoint is `POST /api/market/shopping-list/send` with `{ hub, items, recipientCharacterId }`.

---

## Important ESI realities (useful background)

Several things players expect work differently or not at all through ESI. These shape how this app behaves:

- **ESI cannot create a fleet.** The boss has to press `Fleet → Create Fleet` in-client once. After that, this app does everything else.
- **ESI cannot populate the in-game buddy watchlist.** But once every alt is in the boss's fleet, the Photon UI **Fleet Watchlist** panel auto-populates in every client — same effect, no extra work.
- **ESI cannot accept invites.** You still click Accept on each client. Once a character joins, their row shows a green ✓ pill and the "Invite selected" button skips them next time.
- **ESI cannot post to chat or broadcast fleet commands.** Both were removed in 2018 / never existed. Don't waste time looking for them.
- **Fleet write endpoints and `GET /fleets/{id}/wings/` require `fleet_commander` role, not just fleet ownership or membership.** This is CCP's rule, not ours — a squad_member or squad_commander token (even the fleet owner if they're sitting in a squad) gets a 404 on these. Empirically verified: `/fleets/{id}/wings/` returns `404 "The fleet does not exist or you don't have access to it!"` for non-FC tokens. The sidebar nudges you to move the boss to the Fleet Commander slot in-client when needed; for the "see my pilots' current squads" case, the app falls back to aggregating each pilot's own `wing_id`/`squad_id`.
- **ESI's fleet registration has a 10–60 s lag** after a fresh fleet is formed. During that window `/fleets/{id}/wings/` returns 404 even for a legit FC. The app re-polls every 2.5 s and enables invite/move once the structure is readable.
- **The in-client "Set as Default" wing/squad flag is not exposed via ESI.** `GET /fleets/{id}/` returns `motd`, `is_free_move`, `is_registered`, `is_voice_enabled` and nothing else; `GET /fleets/{id}/wings/` returns `id`, `name`, and `squads[]` per wing. No default marker. That's why the app asks you to pick an invite target explicitly.
- **CSPA charges** set by a character block fleet invites to them; ESI returns 403 and the UI surfaces it per row.
- **ESI returns non-ASCII ship names as Python `repr()` strings** like `u'\u30e0 FantasticScans…'`. This app decodes them server-side so you see the real characters.
- **PI is read-only beyond what's already exposed.** ESI lets you read planet layouts, pin contents, extractor timers, factory schematics, and storage. It does **not** expose ways to install / restart extractors, lay routes, or upgrade Command Centers — those still require the client.
- **PI commodity → tier classification is hard-coded.** ESI doesn't tell you whether `Mechanical Parts` is P2 vs P3, so the app maintains a small static map (`src/esi/pi-data.ts`). P0 and P1 are exhaustive; P2 covers all 23 second-tier commodities; P3 and P4 fall through to "P3+" since they're rarely stockpiled on-planet.

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
   - `esi-ui.open_window.v1`
   - `esi-planets.manage_planets.v1`
   - `esi-mail.send_mail.v1`
5. Save and copy the Client ID and Secret.

> If you're upgrading from an earlier version that didn't include `esi-planets.manage_planets.v1`, `esi-ui.open_window.v1`, or `esi-mail.send_mail.v1`, every existing character must be re-authed (Add character → SSO popup → same alt) before their PI data shows up, the Skills view's per-row Info / Market buttons stop 403-ing, and the Shopping List "Send as EVEmail" button stops 401-ing. ESI tokens don't retroactively gain new scopes.

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
3. **Form the fleet in-client**: on the boss character, open the Fleet menu → Create Fleet. The app's sidebar flips to green **"Fleet commander · fleet NNNNN"** within ~30 s (ESI cache). The **Invite target** dropdown populates with the fleet's wings/squads.
4. **(Optional) Pick a specific squad** in the Invite target dropdown if you don't want the Auto (first wing / first squad) default.
5. **Invite selected**: hit the button. Each alt gets an in-client fleet invite popup. The app reports per-alt results.
6. **Tab through each client and click Accept**. Rows light up with green ✓ pills as alts join.
7. **Drive the group around**: use the "Set waypoint on all clients" search (type `jit`, Enter) to fan the autopilot out to every online alt.

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
- `src/polling/scheduler.ts` — one task per character, fans out across per-endpoint timers (location: 5s, ship: 5s, online: 60s, wallet: 120s, SP: 120s, implants: 120s, fleet: 5s, corp: 3600s, planets: 600s), emits diffs over an in-memory event bus. Full PI pin lists are kept in a separate module-level cache (`pinCache`) keyed by `charId:planetId` so the colony drill-down and inventory roll-up routes can read pins without re-hitting ESI; pin payloads stay *out* of the SSE/snapshot stream to keep updates lean.
- `src/routes/stream.ts` — SSE endpoint that pipes the event bus to the browser with heartbeats.
- `src/routes/planets.ts` — system search (`/api/planets/system/:id`), per-colony detail (`/api/planets/colony/:charId/:planetId`), inventory roll-up (`/api/planets/inventory`), and saved-systems CRUD (`/api/planets/saved`). The system and saved endpoints share a `buildSystemPlanetList(systemId, overlay)` helper so saved blocks render identically to live search results.
- `src/esi/pi-data.ts` — static PI metadata: planet-type → P0 list, P0 → P1 mapping, and commodity-name → tier (P0/P1/P2/P3+) classifier. Keyed by name (not type ID) so it survives any commodity ID drift.
- `src/esi/universe.ts` — bootstraps an 8000+ solar-system cache on first boot via `POST /universe/names/`, backs the in-app waypoint autocomplete and system search. Also caches planet names, schematic names, and corp tickers under categorized keys in `universe_names`.
- `src/routes/skills.ts` + `src/skills/mastery-data.ts` — ship / item search (`/api/skills/ships`, `/api/skills/items`), Mastery plan resolver (`/api/skills/plan`), item-skill plan resolver (`/api/skills/item-plan`), saved-plan CRUD (`/api/skills/plans`), and the open-window helper (`/api/skills/open-window`). The mastery JSON is bundled (~71 lines of summary indices); the full per-ship skill graph is generated from CCP's SDE by `scripts/build-mastery-data.ts` (run via `npm run build:mastery`). The downloaded SDE zip is cached under `.cache/sde.zip` and gitignored — it's ~100 MB.
- `src/routes/market.ts` — PLEX history + orders (`/api/market/plex/{history,orders}`), the shopping-list quoter (`POST /api/market/shopping-list/quote`), and the EVEmail sender (`POST /api/market/shopping-list/send`). Hub constants live at the top of the file (Jita, Amarr); the order-book walker filters by `system_id` so "in Jita" really means "in Jita." `runQuote(hubKey, items, log)` is the shared pricing path both endpoints use. The mail sender re-prices at send-time and formats the body with `<a href="showinfo:TYPE_ID">` links per item. Type-id resolution caches forever; orders cache 5 min (matches ESI).
- `web/src/hooks/useTableState.ts` — sort + column-width state persisted to `localStorage`.

### Adding new ESI fields

Follow the pattern established in `scheduler.ts`:

1. Add the scope to `src/auth/scopes.ts` and re-auth every character (their old tokens don't retroactively gain new scopes).
2. Add an ESI wrapper in `src/esi/…`.
3. Add a new timer field + polling branch in the scheduler.
4. Extend `CharacterStatus` in `src/types.ts` and `web/src/api.ts`.
5. Render it in `CharacterCard.tsx` (and possibly add a sortable column in `App.tsx` + the CSS grid template).

Obvious candidates (surveyed, not implemented): industry job ETAs, jump-clone cooldown, fatigue timer, unified notifications feed (low-fuel structure alerts), `POST /ui/openwindow/marketdetails/` to pop a market window on every client. PI extractor timers, factory schedules, and storage roll-up — *implemented* in the Planets view above.

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
| Planet rows show `loading` or `0/—` colonies, log spams `401 esi-planets.manage_planets.v1` | The pilot's token predates the PI scope. Re-auth them via Add character.                       |
| Colony drill-down shows `colony not yet polled — try again in a few seconds`        | Scheduler hasn't completed its first PI tick for that pilot (10-min cycle). Wait or refresh.   |
| Fleet PI inventory shows lower totals than expected                                  | Inventory only counts what's currently in storage / launchpad / CC pins. Material in transit between pins isn't reported by ESI. |
| Skills view's Info / Market buttons return 403                                       | Pilot's token predates the `esi-ui.open_window.v1` scope. Re-auth that alt via Add character. |
| Skills view shows a yellow "SDE outdated" banner                                     | CCP shipped a newer SDE than the bundled mastery data. Run `npm run build:mastery` to rebuild (downloads / caches the SDE under `.cache/`). |
| Shopping List shows several `unknown item` rows                                      | Names didn't match `POST /universe/ids/`. Check spelling against the in-game item exactly — copy the inventory line if in doubt. ESI name matching is case-sensitive. |
| Shopping List shows `no sellers` for a popular item                                  | Most likely the chosen hub doesn't currently stock that item in-system. Try the other hub. Subtotal will be 0 ISK for that row. |
| Shopping List **Send as EVEmail** returns 401 / "needs re-auth"                      | Pilot's token predates the `esi-mail.send_mail.v1` scope. Click **Add character** on that alt in the sidebar to re-auth. |

---

## Repo

https://github.com/cyrdax/LoW-manager
