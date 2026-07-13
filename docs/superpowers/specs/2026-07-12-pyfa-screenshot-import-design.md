# pyfa Screenshot Import Design

## Context

The Fits tab currently imports EFT text through the import modal, posts it to `/api/fits/preview`, and then reuses the same draft, warning, pricing, save, doctrine, copy, and in-game send flows. The pyfa screenshot importer should feed that existing path instead of creating a parallel fit system.

Users often have a pyfa window open with a fit visible, but may not have copied EFT text. The screenshot contains useful visible data: the pyfa tab title for hull and fit name, visible slot section rows, loaded charges shown in the far-right column, and whichever additions tab is currently open. It does not contain hidden additions tabs.

## Goal

Add a screenshot import mode that converts a visible pyfa screenshot into editable EFT text, then lets the user preview it through the existing fit importer.

Version 1 should:

- Accept one image from the fit import modal.
- Extract only visible pyfa content.
- Generate normal EFT-style text.
- Put the generated EFT text in the existing textarea for user review and edits.
- Use the current Preview button, parser, mismatch warning modal, pricing, save, copy, doctrine, and send behavior.
- Avoid storing uploaded images.

## Non-Goals

- Guessing hidden pyfa tabs such as closed Cargo, Drones, Fighters, Implants, Boosters, Projected, Command, or Notes tabs.
- Importing pyfa stats such as DPS, tank, capacitor, resistances, resources, targeting, or pyfa price totals.
- Perfect OCR for every pyfa theme, scale, crop, or monitor resolution.
- Persisting original screenshots.
- Training or managing a custom OCR model.
- Auto-saving generated fits.

## User Experience

The import modal gets two modes:

- `Paste EFT`
- `pyfa Screenshot`

Screenshot flow:

1. User opens Fits and clicks Import.
2. User chooses `pyfa Screenshot`.
3. User selects or drops an image.
4. User clicks `Extract`.
5. The app shows extraction progress.
6. If extraction succeeds, the modal switches to `Paste EFT` mode with generated EFT text in the textarea.
7. A small notice says the text was generated from a screenshot and should be reviewed.
8. User edits the text if needed.
9. User clicks the existing `Preview` button.

The generated text should look like this:

```text
[Paladin, Fabricator]

Mega Pulse Laser II, Conflagration L
Core Probe Launcher I, Sisters Core Scanner Probe
Mega Pulse Laser II, Conflagration L
Bastion Module I
Heavy Energy Nosferatu II
Mega Pulse Laser II, Conflagration L
Auto Targeting System I
Mega Pulse Laser II, Conflagration L

Tracking Computer II, Optimal Range Script
Republic Fleet Large Cap Battery
Republic Fleet Large Cap Battery
Cap Recharger II

Core X-Type EM Armor Hardener
Core X-Type EM Armor Hardener
Heat Sink II
Core X-Type Large Armor Repairer
Heat Sink II
Thermal Armor Hardener II
Thermal Armor Hardener II

Large Capacitor Control Circuit II
Large Capacitor Control Circuit I

Synth Exile Booster
Synth Drop Booster
Agency 'Pyrolancea' DB5 Dose II
```

Quantities should be included only when the visible pyfa row clearly shows an item count. Loaded charges shown as `Charge Name (1, 1000 cycles)` should be normalized to `Charge Name` in the EFT comma format.

## Architecture

Add a backend extractor boundary:

```ts
export interface PyfaScreenshotExtractor {
  extract(input: PyfaScreenshotInput): Promise<PyfaScreenshotExtraction>;
}
```

The route depends on this interface, not directly on the provider. Production uses a vision extractor configured by environment variables. Tests use a mock extractor.

Data flow:

1. Frontend reads the selected image as base64 and posts JSON to a new authenticated route.
2. Route validates mime type, byte size, and auth.
3. Route calls the configured extractor.
4. Server validates and normalizes the structured extraction result.
5. Server renders EFT text.
6. Frontend receives `{ rawEft, warnings }` and places `rawEft` in the existing import textarea.

Proposed route:

```http
POST /api/fits/import-pyfa-image
Content-Type: application/json
```

Request:

```ts
{
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}
```

Response:

```ts
{
  rawEft: string;
  warnings: string[];
}
```

Using JSON avoids adding multipart parsing for V1. The server should reject payloads above a configured image byte limit before calling the extractor.

## Provider

Use the recommended vision/OCR provider for V1, behind the extractor interface.

Environment:

- `OPENAI_API_KEY` is required when screenshot import is enabled.
- `PYFA_IMAGE_IMPORT_MAX_BYTES` defaults to a conservative limit such as 5 MB.
- `PYFA_IMAGE_IMPORT_MODEL` can override the model without code changes.

If `OPENAI_API_KEY` is missing, the route returns a clear `pyfa_image_import_not_configured` error. The UI should show that message without breaking normal EFT paste import.

## Extraction Contract

The extractor should return strict structured data:

```ts
interface PyfaScreenshotExtraction {
  shipName: string | null;
  fitName: string | null;
  sections: Array<{
    role: 'high' | 'mid' | 'low' | 'rig' | 'service' | 'subsystem' | 'extras';
    items: Array<{
      name: string;
      quantity?: number;
      loadedCharge?: string | null;
      confidence?: number;
    }>;
  }>;
  warnings: string[];
}
```

Rules:

- The tab title such as `Paladin: Fabricator` maps to `[Paladin, Fabricator]`.
- pyfa section headers such as `- 8 High Slots -` map to EFT blank-line sections.
- Only the item-name column should be imported from fitted rows.
- Numeric fitting stats, prices, ranges, CPU/PG, and right-side character stats should be ignored.
- Loaded charges from the far-right column should become `Module, Charge`.
- Parenthetical counts/cycles on loaded charges should be removed.
- Open additions tab rows should be imported as extras.
- Hidden additions tabs are not inferred.
- Rows with uncertain names should produce warnings and should not be silently corrected into unrelated items.

## Error Handling

Return a user-facing error when:

- No image is provided.
- The image is too large.
- The mime type is unsupported.
- The provider is not configured.
- The provider fails.
- The extractor cannot find a ship name, fit name, or any visible items.

Return warnings when:

- Some visible rows could not be confidently read.
- A loaded charge was visible but could not be paired with a module.
- The screenshot appears cropped.
- The additions tab content may be incomplete.

The existing Preview path remains the final validator for EVE item names and hull metadata. Unmatched items continue to open the existing mismatch modal.

## Security and Privacy

- The route requires a logged-in app user.
- Uploaded images are processed transiently and are not written to disk or database.
- Logs must not include base64 image data.
- Validation runs before the provider call to avoid sending oversized or unsupported files.
- Normal fit visibility rules remain unchanged; generated text is not saved until the user manually saves it.

## Testing

Add tests at three levels:

- Pure unit tests for rendering `PyfaScreenshotExtraction` into EFT text.
- Route tests using a mocked extractor to verify validation, auth, provider errors, and success response.
- Frontend source or component tests confirming the screenshot mode exists, calls the import-image helper, and writes generated EFT text into the existing import textarea.

Manual verification should include:

- Uploading the provided Paladin pyfa screenshot locally.
- Confirming generated EFT is editable.
- Clicking Preview.
- Confirming mismatches appear in the existing alert modal.
- Confirming no fit is saved until Save is clicked.

