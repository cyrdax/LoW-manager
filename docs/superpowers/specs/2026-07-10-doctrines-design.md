# Doctrine Collections Design

## Goal

Add doctrine management to the existing Fits tab so a user can group saved fits into named doctrines, describe how the composition works, and search doctrines by doctrine name or the ships/fits inside them.

## Scope

V1 doctrines are simple collections of existing saved fits. A doctrine has a name, a description, timestamps, and an ordered set of saved-fit members. Members do not have per-doctrine roles, quantities, pricing, or export behavior in this version.

## User Experience

The existing `Fits` tab gains an internal segmented control with two modes: `Fits` and `Doctrines`.

In `Fits` mode, the current saved-fit library, import flow, fit detail view, pricing, copy EFT, and send-to-pilot behavior remain unchanged.

In `Doctrines` mode:

- The left pane becomes a doctrine library.
- A search input filters doctrines by doctrine name, doctrine description, member ship names, and member fit names.
- The main pane shows the selected doctrine.
- The doctrine detail surface includes editable doctrine name and description fields.
- The member list shows saved fits with ship icon, ship name, fit name, and warning count.
- An `Add fit` control searches existing saved fits and adds the selected saved fit to the doctrine.
- Each member has a remove action that removes the fit from the doctrine without deleting the saved fit.
- A delete action deletes the doctrine without deleting saved fits.

The empty state says that the user can create a doctrine from saved fits. If the last fit is removed from a doctrine, the doctrine remains with an empty member list.

## Data Model

Add `doctrines`:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

Add `doctrine_fits`:

- `doctrine_id INTEGER NOT NULL`
- `fit_id INTEGER NOT NULL`
- `sort_order INTEGER NOT NULL`
- `PRIMARY KEY (doctrine_id, fit_id)`
- `FOREIGN KEY (doctrine_id) REFERENCES doctrines(id) ON DELETE CASCADE`
- `FOREIGN KEY (fit_id) REFERENCES saved_fits(id) ON DELETE CASCADE`

Indexes:

- `idx_doctrines_updated` on `doctrines(updated_at)`
- `idx_doctrine_fits_doctrine` on `doctrine_fits(doctrine_id, sort_order)`
- `idx_doctrine_fits_fit` on `doctrine_fits(fit_id)`

A doctrine references saved fits only. If a saved fit is edited, doctrine detail reflects the updated saved-fit summary. If a saved fit is deleted, it is removed from all doctrines through cascade delete.

## API

Add doctrine endpoints under the Fits API surface:

`GET /api/doctrines?q=...`

- Returns doctrine summaries ordered by `updated_at DESC, id DESC`.
- Search matches doctrine name, doctrine description, member ship name, and member fit name.
- Empty or omitted `q` returns all doctrines.

`POST /api/doctrines`

- Creates a doctrine.
- Required body: `name`.
- Optional body: `description`.
- Blank names return `400`.

`GET /api/doctrines/:id`

- Returns full doctrine detail with member saved-fit summaries.
- Missing doctrine returns `404`.

`PUT /api/doctrines/:id`

- Updates name and description.
- Blank names return `400`.
- Missing doctrine returns `404`.

`DELETE /api/doctrines/:id`

- Deletes the doctrine and member links.
- Does not delete saved fits.
- Missing doctrine returns `404`.

`POST /api/doctrines/:id/fits`

- Adds a saved fit to the doctrine.
- Body: `{ "fitId": number }`.
- Invalid IDs return `400`.
- Missing doctrine or saved fit returns `404`.
- Adding the same fit twice is treated as success/no-op.

`DELETE /api/doctrines/:id/fits/:fitId`

- Removes a saved fit from the doctrine.
- Invalid IDs return `400`.
- Missing doctrine returns `404`.
- Removing a non-member fit from an existing doctrine is treated as success/no-op.

## Store Interfaces

Create a doctrine store alongside the existing fit store. The store owns doctrine migration, doctrine CRUD, membership changes, and search. Member rows use the same saved-fit summary fields as the Fits library.

Required exported interfaces and functions:

- `DoctrineSummary`
- `DoctrineDetail`
- `DoctrineFitMember`
- `createDoctrineStore(database, options)`
- `migrateDoctrinesDb(database)`

`DoctrineSummary` includes `id`, `name`, `description`, `createdAt`, `updatedAt`, `fitCount`, and a compact list of member ship names for display/search context.

`DoctrineDetail` includes the summary fields plus `fits: DoctrineFitMember[]`.

`DoctrineFitMember` wraps saved-fit summary fields and includes `sortOrder`.

Adding a fit appends it after the current highest `sortOrder`. Duplicate add keeps the existing row and existing order.

## Search Behavior

Doctrine search is case-insensitive and trims whitespace.

A doctrine matches when the query appears in any of:

- doctrine name
- doctrine description
- member ship name
- member fit name

Results remain doctrine-level results. Searching `Scimitar` returns doctrines that contain Scimitar fits; it does not return individual fits as top-level rows.

## Error Handling

API errors use the existing simple JSON shape:

```json
{ "error": "message" }
```

Expected cases:

- Invalid IDs return `400`.
- Blank doctrine names return `400`.
- Missing doctrines return `404`.
- Missing saved fits on add return `404`.
- Duplicate add is success/no-op.
- Removing a fit that is not in the doctrine is success/no-op when the doctrine exists.

## Testing

Backend tests cover:

- Doctrine DB migration creates tables and indexes.
- Deleting a doctrine deletes membership rows but not saved fits.
- Deleting a saved fit removes it from doctrine membership.
- Store create, update, delete, add fit, remove fit, list, detail.
- Search by doctrine name.
- Search by doctrine description.
- Search by member ship name.
- Search by member fit name.
- Duplicate add is success/no-op.
- Removing a non-member fit from an existing doctrine is success/no-op.
- API validation for invalid IDs, blank names, missing doctrine, and missing fit.

Frontend checks cover:

- API types and helpers for doctrine summaries/details.
- Fits tab exposes `Fits | Doctrines` modes.
- Doctrine mode includes doctrine search, create, edit description, add saved fit, remove saved fit, and delete controls.

## Out Of Scope For V1

- Per-fit doctrine roles.
- Per-fit target quantities.
- Whole-doctrine price totals.
- Whole-doctrine in-game export.
- Importing unsaved draft fits directly into a doctrine.
- Doctrine sharing, permissions, or character-specific assignments.
- Drag-and-drop member reordering. `sort_order` exists so ordering can be added without a schema change.
