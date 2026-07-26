# Doctrine Google Doc Fit Sync Design

## Goal

Add a doctrine-level refresh action that reads EFT fit blocks from the doctrine's existing Google Doc URL, updates matching saved fits, and creates missing saved fits without removing anything from the doctrine.

## User Flow

In the doctrine view, an owner or admin can click `Refresh Fits` when the doctrine has a Google Doc URL. The app fetches the public Google Doc as plain text, extracts EFT blocks beginning with `[Ship, Fit Name]`, and applies them to the doctrine library.

The result summary shows counts and details for:

- Updated fits
- Created fits
- Skipped blocks
- Ambiguous matches
- Failed blocks

## Source Document

The sync uses the doctrine's existing `googleDocUrl`. No second URL field is added.

The Google Doc must be publicly readable by link. V1 fetches the document through the unauthenticated Google Docs text export endpoint. Private Google Drive access is out of scope.

## Fit Parsing

The parser scans plain text for EFT headers:

```text
[Ship Name, Fit Name]
```

Each header begins a fit block. The block continues until the next EFT header or end of document. Introductory prose before the first header is ignored.

The extracted block is passed through the existing fit draft/save pipeline, so existing validation, normalization, metadata resolution, warnings, slot assignment, and item extraction remain the source of truth.

## Matching And Updates

Existing doctrine members are matched by normalized saved fit name:

- Case-insensitive
- Trimmed whitespace
- Collapsed internal whitespace

When exactly one current doctrine fit matches a parsed fit name, refresh updates that saved fit's `rawEft`. Notes and doctrine membership are preserved.

When no doctrine fit matches, refresh creates a new saved fit from the EFT block and adds it to the doctrine.

When multiple doctrine fits match the same normalized name, refresh skips that block and reports an ambiguous match.

Refresh never removes saved fits from the doctrine, even if they are missing from the Google Doc.

## Ownership And Visibility

Only the doctrine owner or an admin can refresh.

Created fits inherit the doctrine visibility:

- Private doctrine: create private fits owned by the current user.
- Public doctrine: create public fits.

Public doctrine refresh may update public doctrine member fits. Private doctrine refresh updates private member fits visible in that doctrine. Existing route permissions still protect unauthorized updates.

## API

Add:

```http
POST /api/doctrines/:id/refresh-fits
```

Response shape:

```ts
interface DoctrineFitRefreshResult {
  doctrine: DoctrineDetail;
  updated: Array<{ fitId: number; fitName: string; shipName: string }>;
  created: Array<{ fitId: number; fitName: string; shipName: string }>;
  skipped: Array<{ fitName: string; reason: string }>;
  ambiguous: Array<{ fitName: string; matchedFitIds: number[] }>;
  failed: Array<{ fitName: string; error: string }>;
}
```

## UI

In doctrine view mode, show `Refresh Fits` beside owner/admin actions when `googleDocUrl` is present. During refresh, disable the button and show progress text.

After refresh, show a compact summary message. If there are ambiguous, skipped, or failed blocks, show their names and reasons in the status area.

## Error Handling

The route returns clear errors for:

- Missing Google Doc URL
- Invalid or unsupported Google Doc URL
- Document fetch failure
- Empty document or no EFT blocks
- Unauthorized refresh attempt

Partial success is allowed. A malformed block does not fail the whole refresh; it is reported in `failed`.

## Tests

Cover:

- Parser extracts multiple EFT blocks from mixed prose.
- Route rejects users who cannot edit the doctrine.
- Route updates one matching fit.
- Route creates new fits and adds them to the doctrine.
- Route skips ambiguous name matches.
- Route does not remove doctrine fits absent from the Google Doc.
- Frontend exposes the refresh button and API helper.
