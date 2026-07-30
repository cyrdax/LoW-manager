# Discord Fit Import Design

Date: 2026-07-29

## Goal

Add a Discord-backed fit importer so any logged-in user can scan recent channel or thread history for EVE fits, review the results, and import them into the existing Fits library.

The V1 importer should feel like another import method beside paste and Pyfa screenshot import. It should not create doctrines directly; users can add imported fits to doctrines later through the existing doctrine UI.

## Scope

V1 supports:

- A Discord tab inside the existing Fits import modal.
- One Discord guild/server configured by the app environment.
- A backend Discord bot token, never a personal Discord user token.
- A channel/thread picker showing all visible channels and threads the bot can read.
- One selected channel/thread scanned at a time.
- Last 100 messages per scan.
- EFT-style text blocks in message content and code blocks.
- Pyfa screenshot images in message attachments.
- Up to 10 images OCR-scanned per import run.
- A scan summary showing scanned messages, found fits, scanned images, and skipped images.
- A review screen grouped by source Discord message.
- Import into saved fits only, using the current Private/Public library scope.
- Duplicate matching by same resolved hull and normalized fit name.
- Per-fit action selection: Create, Update existing, or Skip.
- Discord source metadata preserved in saved fit notes.

V1 does not support:

- Creating doctrines directly from Discord scans.
- Importing text, EFT, or other file attachments.
- Scanning multiple channels in one operation.
- Saved Discord channel presets.
- Custom scan limits in the UI, though the backend should be structured so this can become configurable later.
- Reading beyond bot-visible channels or bypassing Discord permissions.

## Discord Requirements

The app uses a Discord application with a bot user. The bot must be invited to the configured guild and granted:

- View Channel
- Read Message History
- Message Content Intent, so message text can be read

Relevant Discord API capabilities:

- `GET /guilds/{guild.id}/channels` lists guild channels visible to the bot.
- `GET /channels/{channel.id}/messages` reads channel or thread message history, up to 100 messages per request.
- Message objects include message content, author metadata, timestamps, attachment metadata, and a message ID that can be converted into a Discord jump link.

Environment:

```env
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
```

## User Flow

1. User opens Fits.
2. User clicks Import.
3. User chooses the Discord tab.
4. App loads channels/threads visible to the bot and sorts them alphabetically.
5. User chooses one channel or thread.
6. User clicks Scan.
7. Backend reads the last 100 messages from that channel/thread.
8. Backend extracts EFT text blocks and scans up to 10 Pyfa screenshot images.
9. UI shows grouped review results by source message.
10. User chooses Create, Update existing, or Skip per fit.
11. User clicks Import selected.
12. Backend creates/updates saved fits in the current library visibility.

## Channel And Thread Picker

The picker should show all readable text-like destinations the bot can see:

- Text channels
- News/announcement channels if readable
- Forum/media post threads where available
- Active and archived threads where the bot has permission and Discord exposes them

Entries should be sorted alphabetically by display label. Threads should appear as their own selectable rows with the parent channel in the label:

```text
cap-fits
cap-fits / Marauders
doctrine-fits
doctrine-fits / Paladin thread
```

Each scan still targets one channel or thread ID.

## Fit Detection

Text extraction should reuse the shared EFT block extraction behavior where practical:

- Match full EFT headers like `[Paladin, Fabricator]`.
- Include following EFT item lines and blank section separators.
- Stop before trailing prose after a blank separator so explanations do not become unmatched fit rows.
- Ignore partial module lists without a header in V1.
- Extract from normal message content and fenced code blocks without requiring users to format messages perfectly.

Pyfa screenshots should reuse the existing Pyfa screenshot import path:

- Consider only image attachments from the scanned messages.
- OCR up to 10 images per scan.
- If more than 10 images are present, report how many were skipped because of the V1 limit.
- Skipped images should be shown as skipped, not failed.
- OCR failures should attach to the source message as warnings.

## Review Model

The scan result should be grouped by Discord source message:

- Channel/thread label
- Author display name
- Message timestamp
- Discord jump link
- Source text excerpt capped at 240 characters when message text contributed a fit
- Image scan status when present
- Fits discovered from that message

Each discovered fit row should show:

- Ship icon and resolved hull
- Fit name
- Source type: EFT text or Pyfa image
- Warning count and warnings preview
- Duplicate status
- Default action
- Action selector

Default duplicate behavior:

- If a saved fit exists in the current library scope with the same resolved hull and normalized fit name, default to Update existing.
- Otherwise default to Create.
- User can override to Create, Update, or Skip.

If a fit cannot resolve its hull, keep it visible in review with warnings, default to Skip, and disable Create/Update for that row.

## Import Behavior

Imports create or update saved fits only.

Visibility:

- Use the current Fits library scope.
- Private scope creates/updates private fits owned by the current app user.
- Public scope creates/updates public fits only if the user has the same permissions already required elsewhere in the app.

Notes:

- Preserve Discord source metadata by appending or setting a source note.
- Include channel/thread name, author, timestamp, and message link.
- Do not overwrite user-authored notes on update without making that behavior explicit in review.

V1 update behavior:

- Update the EFT content and parsed fit details.
- Append a new Discord source note if it is not already present.
- Keep existing notes otherwise.

## Backend Shape

Add a Discord import module with clear boundaries:

- Discord API client:
  - list readable channels/threads
  - fetch recent messages for one channel/thread
  - download image attachment bytes for Pyfa OCR
- Discord fit extractor:
  - parse message content for EFT blocks
  - identify image attachments
  - run capped Pyfa image extraction
  - return normalized scan results
- Import planner:
  - compare discovered fits against saved fits in the current visibility
  - assign default Create/Update/Skip actions
- Import executor:
  - validate user-selected actions
  - create/update saved fits through the existing fit store

Suggested API routes:

```text
GET  /api/discord/import/channels
POST /api/discord/import/scan
POST /api/discord/import/apply
```

All routes require a logged-in app user.

## Error Handling

User-facing errors should distinguish:

- Discord bot token missing
- Guild ID missing
- Bot lacks channel permissions
- Message Content Intent missing or message content unavailable
- Channel/thread not found
- Discord rate limited
- Pyfa OCR provider not configured
- Pyfa OCR failures for individual images
- No fits found

The scan route should return partial results when possible. A failed image OCR should not discard text fits from the same scan.

## Security And Privacy

- Never store or expose `DISCORD_BOT_TOKEN`.
- Never use user Discord tokens.
- Do not show channels the bot cannot see.
- Any logged-in app user can scan bot-visible channels, per product decision for V1.
- Saved fit visibility still follows existing app rules.
- Message content should only be stored as source metadata needed for traceability, not as full channel history.
- Image bytes should be transient and not persisted.

## Testing

Backend tests:

- Channel list maps Discord channel/thread objects into sorted picker entries.
- Scan fetches only the last 100 messages.
- EFT blocks are extracted from message text and code blocks.
- Trailing Discord prose after an EFT block is not imported as fit items.
- Image attachments are capped at 10 and skipped count is reported.
- Pyfa OCR failures are reported without failing the whole scan.
- Duplicate matching defaults to Update existing by hull plus fit name.
- Apply creates, updates, and skips according to selected actions.
- Auth is required for all routes.

Frontend/static tests:

- Fits import modal exposes Paste EFT, Pyfa Screenshot, and Discord tabs.
- Discord tab shows channel picker, scan button, summary, grouped review, action selectors, and import button.
- Skipped image count is visible when the cap is exceeded.
- Review rows surface warnings and source message links.

## Open Extension Points

- Custom scan limits such as 100, 500, or between message links.
- Saved channel presets.
- Import directly into doctrine tabs.
- Background scheduled scans.
- Loose module-list inference without EFT headers.
- Discord slash command that posts a fit directly into the app.
