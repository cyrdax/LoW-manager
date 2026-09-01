# Test Plan

Project: LoW Manager / Outfit420
Version: 0.2 draft
Date: 2026-09-01
Status: Practical test coverage outline

## 1. Purpose

This test plan defines the core verification approach for LoW Manager. The goal is to confirm that authentication, EVE pilot authorization, private/public library behavior, fit workflows, doctrine workflows, market pricing, contracts, assets, and production deployment behave as expected.

## 2. Test Scope

In scope:

- Account creation and login
- Google OAuth login
- EVE account OAuth login with automatic pilot creation
- EVE pilot authorization
- EFT and fit-screenshot import, save, pricing, export, and send-to-game
- Doctrine creation and public/private visibility
- Public anonymous fit/doctrine viewing
- Market shopping list parsing
- Contract search
- Asset refresh and asset table interactions
- Discord fit import
- Production health checks

Out of scope:

- EVE server-side correctness beyond ESI contract behavior
- Third-party provider uptime
- Full load testing
- Native mobile browser certification

## 3. Test Strategy

| Test Type | Purpose | Tooling |
| --- | --- | --- |
| Unit tests | Validate parsers, stores, helpers, pricing, route behavior | Node test runner |
| Integration tests | Validate API route behavior and database-aware flows | Node test runner, optional PostgreSQL env |
| Static checks | Validate TypeScript and frontend build | `npm run build` |
| Manual UAT | Confirm interactive workflows and visual behavior | Browser |
| Production smoke | Confirm deployed service and public routes | `/api/health`, live browser |

## 4. Entry Criteria

- Code is committed to a working branch or main.
- Required environment variables are configured for the environment being tested.
- Test users and EVE pilots are available.
- Railway deployment can access PostgreSQL.
- Optional integrations are either configured or expected to return clear configuration errors.

## 5. Exit Criteria

- `npm test` passes with no unexpected failures.
- `npm run build` passes.
- Production deployment reaches `SUCCESS`.
- `/api/health` returns `{"ok":true}`.
- Key manual user flows pass in browser.

## 6. Test Scenarios

### 6.1 Authentication

| ID | Scenario | Expected Result |
| --- | --- | --- |
| AUTH-001 | Create account with email/password | User is created and verification email is sent |
| AUTH-002 | Log in with unverified email | Login is rejected |
| AUTH-003 | Verify email then log in | Session is created |
| AUTH-004 | Log in with Google | Google user is created or matched |
| AUTH-005 | Log in with EVE Online | Account and authenticated pilot are created or matched, and a session is created |
| AUTH-006 | Log out | Session cookie is cleared |
| AUTH-007 | Request password reset | Reset email is sent without leaking account existence |

### 6.2 EVE Pilot Authorization

| ID | Scenario | Expected Result |
| --- | --- | --- |
| PILOT-001 | Add an EVE pilot | Pilot appears under the signed-in account |
| PILOT-002 | Select main pilot | Main pilot avatar/name updates |
| PILOT-003 | Expired token refresh | Token refreshes or pilot is marked reauth needed |
| PILOT-004 | User attempts access to another user's pilot | Request is rejected |

### 6.3 Fits

| ID | Scenario | Expected Result |
| --- | --- | --- |
| FIT-001 | Paste valid EFT fit | Preview displays assigned slots |
| FIT-002 | Paste fit with unknown items | Alert lists mismatches |
| FIT-003 | Save fit as private | Fit appears in private library only |
| FIT-004 | Publish fit | Fit appears in public library |
| FIT-005 | Copy public fit private | Private copy is created |
| FIT-006 | Refresh price | Hull, fitted, extras, and grand total update |
| FIT-007 | Open price breakdown | Modal scrolls vertically and groups by slot section |
| FIT-008 | Export EFT | Clipboard receives EFT format |
| FIT-009 | Send fit to pilot | ESI fitting request succeeds or returns actionable error |
| FIT-010 | Upload a Pyfa or in-game fitting screenshot | Visible fitted rows and inventory quantities become an editable EFT preview |

### 6.4 Doctrines

| ID | Scenario | Expected Result |
| --- | --- | --- |
| DOC-001 | Create private doctrine | Doctrine saves with title and description |
| DOC-002 | Add saved fits | Fits appear in doctrine |
| DOC-003 | Remove fit | Fit is removed without deleting the saved fit |
| DOC-004 | Publish doctrine with public fits | Doctrine becomes visible publicly |
| DOC-005 | Publish doctrine with private fit | Request is rejected |
| DOC-006 | Anonymous user opens public doctrine URL | Read-only doctrine page loads |
| DOC-007 | Click fit inside doctrine | User navigates to fit view |

### 6.5 Assets

| ID | Scenario | Expected Result |
| --- | --- | --- |
| ASSET-001 | Refresh all assets | Pilot snapshots update |
| ASSET-002 | Expand pilot row | Locations display |
| ASSET-003 | Expand location row | Asset stacks display |
| ASSET-004 | Sort asset table columns | Rows sort correctly |
| ASSET-005 | Search assets | Matching pilots, locations, and items remain visible |
| ASSET-006 | Missing ESI scope | Cached data is retained and status is shown |

### 6.6 Market and Contracts

| ID | Scenario | Expected Result |
| --- | --- | --- |
| MARKET-001 | Paste shopping list | Items parse with quantities |
| MARKET-002 | Price shopping list | Totals and no-seller warnings display |
| CONTRACT-001 | Search ship contracts near system | Matching contracts display with jumps |
| CONTRACT-002 | Sort contract columns | All visible columns sort |
| CONTRACT-003 | Region index stale | Warming/coverage status displays |

### 6.7 Discord Import

| ID | Scenario | Expected Result |
| --- | --- | --- |
| DISC-001 | List channels/threads | Readable channels are shown alphabetically |
| DISC-002 | Scan channel | Last 100 messages are scanned |
| DISC-003 | Detect EFT text | Fit candidates display |
| DISC-004 | Detect fit screenshots | Up to 10 screenshots are processed |
| DISC-005 | Apply selected imports | Chosen fits are created or updated |

### 6.8 Production Smoke Tests

| ID | Scenario | Expected Result |
| --- | --- | --- |
| PROD-001 | Deploy to Railway | Deployment reaches `SUCCESS` |
| PROD-002 | Hit `/api/health` | Returns `{"ok":true}` |
| PROD-003 | Open public fit URL | Page loads without login |
| PROD-004 | Open public doctrine URL | Page loads without login |
| PROD-005 | Log in on production | User reaches dashboard |

## 7. Regression Checklist

- Main navigation order remains: Pilots, Fleet, Fits, Assets, Market, Contract, Industry, Planets.
- Market tab defaults to Shopping List.
- Public/private selector affects both fits and doctrines.
- Tooltips are instant and not clipped.
- Fit price modal scrolls vertically for long fits.
- Public legal pages are accessible without login.
- Private pilot data is never shown to anonymous users.

## 8. Defect Handling

Each defect should include:

- Environment
- User account or anonymous state
- Route/URL
- Steps to reproduce
- Expected result
- Actual result
- Screenshot if visual
- Browser console/API errors if available

## 9. Test Data

Recommended fit samples:

- Capital fit with cargo and scripts
- Marauder doctrine fit
- Small scanning frigate fit
- Fit with implants in cargo/extras
- In-game fitting screenshot with consolidated fitted and inventory quantities
- Fit with intentionally unknown item names

Recommended users:

- Admin user
- Normal user with authorized pilots
- Normal user with no pilots
- Anonymous viewer

## 10. Approval

This plan is approved for validating that the app does the EVE thing without embarrassing itself in front of the corporation.
