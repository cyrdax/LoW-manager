# Business Requirements Document

Project: LoW Manager / Outfit420
Version: 0.2 draft
Date: 2026-09-01
Owner: Product / Fleet Operations
Status: Friendly paperwork, not a binding artifact

## 1. Executive Summary

LoW Manager is a web application for EVE Online pilots and corporation members to manage authenticated characters, ship fits, doctrines, assets, contracts, market shopping, and operational planning from one shared dashboard.

The application supports personal/private pilot data while allowing public sharing of reusable fleet content such as fits and doctrines. It is designed to reduce manual copy/paste work, improve fit visibility, help players understand costs, and make common corporation workflows easier to coordinate.

## 2. Business Objectives

- Provide a central dashboard for EVE pilots to manage character-related tools.
- Allow multiple users to access the app with their own accounts and authorized pilots.
- Keep private ESI-derived pilot data scoped to the owning user.
- Make public fits and doctrines easy to browse, share, and copy.
- Reduce friction in market preparation by pricing fits and shopping lists.
- Support corporation workflows around doctrines, Discord fit imports, and asset visibility.
- Host the app publicly with production authentication and persistent PostgreSQL storage.

## 3. Stakeholders

| Stakeholder | Interest |
| --- | --- |
| App owner/admin | Operates the app, manages public content, supports members |
| Corporation members | Use personal pilots and shared fits/doctrines |
| Fleet commanders | Share doctrines and fit expectations |
| Industrial/market users | Estimate build, market, and shopping costs |
| Security-conscious users | Expect private pilot data to remain scoped |

## 4. In Scope

- Email/password, Google, and EVE Online account login.
- EVE Online account login that automatically creates the account's first authorized pilot, plus additional pilot authorization per user account.
- Pilot dashboard for authenticated characters.
- Fits dashboard with EFT import, Pyfa and in-game fitting screenshot import, icons, pricing, export, and send-to-game support.
- Doctrine dashboard for collections of saved fits with public/private visibility.
- Public read-only views for public fits and doctrines.
- Market shopping list and fit pricing workflows.
- Contract search by ship and location.
- Asset view aggregating authenticated pilot assets.
- Discord bot-backed fit import from selected channels.
- Public legal pages for Discord bot verification.

## 5. Out of Scope for Current Version

- Creating market buy orders in-game through ESI.
- Full Google Docs doctrine sync. This was removed and will be rebuilt separately.
- Corporation-wide ESI access without individual pilot authorization.
- Mobile-native app packaging.
- Formal billing, subscriptions, or tenant self-service administration.

## 6. Functional Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| BR-001 | Users can create accounts and log in with email/password, Google, or EVE Online. | High |
| BR-002 | EVE account login automatically adds the authenticated character as the account's first pilot, and users can authorize additional pilots. | High |
| BR-003 | Private pilot-derived data is visible only to the owning user. | High |
| BR-004 | Users can create, save, view, copy, publish, and delete ship fits. | High |
| BR-005 | Users can organize saved fits into doctrines. | High |
| BR-006 | Public fits and doctrines are visible without login. | High |
| BR-007 | Users can import fits from EFT text and Pyfa or in-game fitting screenshots. | High |
| BR-008 | Users can price fits by hub and see itemized cost breakdowns. | High |
| BR-009 | Users can search contracts by ship and origin system. | Medium |
| BR-010 | Users can view assets aggregated across authorized pilots. | Medium |
| BR-011 | Users can import fit candidates from Discord channel history. | Medium |
| BR-012 | Admins can edit/delete public items; non-owners can copy public items privately. | Medium |

## 7. Non-Functional Requirements

- Authentication sessions must be secure in production.
- EVE tokens must be encrypted at rest.
- PostgreSQL must be the production data store.
- Production deployment must run migrations before starting.
- Public pages must remain accessible without authentication.
- ESI failures should degrade gracefully and preserve cached data where possible.
- UI should be dense, scannable, and operational rather than marketing-oriented.

## 8. Success Criteria

- A user can sign up with email/password, Google, or EVE Online, authorize pilots, and use the app independently.
- Public doctrines and fits can be shared via direct URLs.
- Private pilot assets, skills, and tokens are not visible across accounts.
- Fit imports and pricing are reliable enough for day-to-day corporation use.
- The hosted app passes health checks and survives redeployment with migrations.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| ESI rate limits or intermittent failures | Cache public data and preserve last-known private snapshots |
| OAuth misconfiguration | Use explicit callback URLs and environment-based configuration |
| Fit parsing edge cases | Keep import preview editable before save |
| Public/private content mistakes | Enforce owner/admin edit rules and copy-to-private workflows |
| Third-party API cost or limits | Use API-backed OCR only where needed and fail clearly when not configured |

## 10. Approval

This document is approved for the important purpose of looking official enough in a group chat.
