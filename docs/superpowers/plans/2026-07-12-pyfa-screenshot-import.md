# pyfa Screenshot Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import visible pyfa screenshots by extracting them into editable EFT text and then reusing the existing fit preview/save flow.

**Architecture:** Add a small backend importer boundary that validates transient image uploads, calls a provider-backed extractor, normalizes structured extraction into EFT text, and returns that text to the existing import modal. The frontend adds a screenshot mode to the import modal, but generated text still flows through the current `previewFit` path.

**Tech Stack:** Fastify, TypeScript ESM, React/Vite, Node `node:test`, OpenAI Responses API over `fetch`, existing fit parser/preview APIs.

## Global Constraints

- Accept one image from the fit import modal.
- Extract only visible pyfa content.
- Generate normal EFT-style text.
- Put the generated EFT text in the existing textarea for user review and edits.
- Use the current Preview button, parser, mismatch warning modal, pricing, save, copy, doctrine, and send behavior.
- Avoid storing uploaded images.
- Hidden pyfa tabs are not inferred.
- The route requires a logged-in app user.
- Uploaded images are processed transiently and are not written to disk or database.
- Logs must not include base64 image data.
- Normal fit visibility rules remain unchanged; generated text is not saved until the user manually saves it.

---

## File Structure

- Create `src/fits/pyfa-image-import.ts`: pure types, validation helpers, extractor interface, EFT renderer, OpenAI extractor implementation, and default factory.
- Create `src/fits/pyfa-image-import.test.ts`: unit coverage for EFT rendering, image validation, configured/missing extractor behavior, and OpenAI payload construction with mocked fetch.
- Modify `src/routes/fits.ts`: add `POST /api/fits/import-pyfa-image`, injectable extractor dependency, and route tests.
- Modify `src/routes/fits.test.ts`: route tests for success, auth, validation, and unconfigured provider errors.
- Modify `web/src/api.ts`: add request/response types and `importPyfaImage` helper.
- Modify `web/src/components/FitsView.tsx`: add import modal mode switch, image file selection/drop, extract action, warnings, and generated-EFT notice.
- Modify `web/src/styles.css`: style import tabs, drop zone, screenshot status, and warnings.
- Modify `src/fits/import-modal-view.test.ts`: source-level regression for screenshot mode and generated text handoff.

## Task 1: Backend pyfa Image Import Domain

**Files:**
- Create: `src/fits/pyfa-image-import.ts`
- Create: `src/fits/pyfa-image-import.test.ts`

**Interfaces:**
- Produces:
  - `export const PYFA_IMAGE_IMPORT_NOT_CONFIGURED = 'pyfa_image_import_not_configured'`
  - `export const DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES = 5 * 1024 * 1024`
  - `export type PyfaImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'`
  - `export interface PyfaScreenshotInput { imageBase64: string; mimeType: PyfaImageMimeType; userId?: string }`
  - `export interface PyfaScreenshotExtractor { extract(input: PyfaScreenshotInput): Promise<PyfaScreenshotExtraction> }`
  - `export function validatePyfaImageInput(input: unknown, maxBytes?: number): PyfaScreenshotInput`
  - `export function renderPyfaExtractionToEft(extraction: PyfaScreenshotExtraction): { rawEft: string; warnings: string[] }`
  - `export function createDefaultPyfaScreenshotExtractor(): PyfaScreenshotExtractor`
- Consumes:
  - `fetch` for provider calls.

- [ ] **Step 1: Write failing unit tests**

Add `src/fits/pyfa-image-import.test.ts` with tests that assert:

```ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createDefaultPyfaScreenshotExtractor,
  PYFA_IMAGE_IMPORT_NOT_CONFIGURED,
  renderPyfaExtractionToEft,
  validatePyfaImageInput,
  type PyfaScreenshotExtraction,
} from './pyfa-image-import.ts';

describe('pyfa screenshot import', () => {
  test('renders visible pyfa extraction as editable EFT text', () => {
    const extraction: PyfaScreenshotExtraction = {
      shipName: 'Paladin',
      fitName: 'Fabricator',
      warnings: ['Visible additions may be incomplete.'],
      sections: [
        { role: 'high', items: [
          { name: 'Mega Pulse Laser II', loadedCharge: 'Conflagration L (1, 1000 cycles)' },
          { name: 'Core Probe Launcher I', loadedCharge: 'Sisters Core Scanner Probe (8)' },
        ] },
        { role: 'mid', items: [{ name: 'Tracking Computer II', loadedCharge: 'Optimal Range Script (1)' }] },
        { role: 'extras', items: [{ name: "Agency 'Pyrolancea' DB5 Dose II", quantity: 11 }] },
      ],
    };

    const rendered = renderPyfaExtractionToEft(extraction);

    assert.equal(rendered.rawEft, [
      '[Paladin, Fabricator]',
      '',
      'Mega Pulse Laser II, Conflagration L',
      'Core Probe Launcher I, Sisters Core Scanner Probe',
      '',
      'Tracking Computer II, Optimal Range Script',
      '',
      "Agency 'Pyrolancea' DB5 Dose II x11",
    ].join('\n'));
    assert.deepEqual(rendered.warnings, ['Visible additions may be incomplete.']);
  });

  test('rejects unsupported mime types and oversized base64 images', () => {
    assert.throws(() => validatePyfaImageInput({ imageBase64: 'AAAA', mimeType: 'image/gif' }), /unsupported image type/i);
    const twoBytes = Buffer.from([1, 2]).toString('base64');
    assert.throws(() => validatePyfaImageInput({ imageBase64: twoBytes, mimeType: 'image/png' }, 1), /image is too large/i);
  });

  test('default extractor reports a clear configuration error without OPENAI_API_KEY', async () => {
    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await assert.rejects(
        () => createDefaultPyfaScreenshotExtractor().extract({ imageBase64: 'AAAA', mimeType: 'image/png' }),
        error => error instanceof Error && error.message === PYFA_IMAGE_IMPORT_NOT_CONFIGURED,
      );
    } finally {
      if (oldKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    }
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --import tsx --test src/fits/pyfa-image-import.test.ts`

Expected: FAIL because `src/fits/pyfa-image-import.ts` does not exist.

- [ ] **Step 3: Implement the pure domain and default extractor shell**

Create `src/fits/pyfa-image-import.ts` with:

```ts
export const PYFA_IMAGE_IMPORT_NOT_CONFIGURED = 'pyfa_image_import_not_configured';
export const DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type PyfaImageMimeType = typeof SUPPORTED_MIME_TYPES[number];

export interface PyfaScreenshotInput {
  imageBase64: string;
  mimeType: PyfaImageMimeType;
  userId?: string;
}

export interface PyfaScreenshotItem {
  name: string;
  quantity?: number;
  loadedCharge?: string | null;
  confidence?: number;
}

export interface PyfaScreenshotSection {
  role: 'high' | 'mid' | 'low' | 'rig' | 'service' | 'subsystem' | 'extras';
  items: PyfaScreenshotItem[];
}

export interface PyfaScreenshotExtraction {
  shipName: string | null;
  fitName: string | null;
  sections: PyfaScreenshotSection[];
  warnings: string[];
}

export interface PyfaScreenshotExtractor {
  extract(input: PyfaScreenshotInput): Promise<PyfaScreenshotExtraction>;
}
```

Implement `validatePyfaImageInput`, `renderPyfaExtractionToEft`, and `createDefaultPyfaScreenshotExtractor` so the tests pass. The default extractor should throw `PYFA_IMAGE_IMPORT_NOT_CONFIGURED` when `OPENAI_API_KEY` is missing; Task 2 fills in the provider call.

- [ ] **Step 4: Run unit test to verify GREEN**

Run: `node --import tsx --test src/fits/pyfa-image-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/fits/pyfa-image-import.ts src/fits/pyfa-image-import.test.ts
git commit -m "feat: add pyfa screenshot import domain"
```

## Task 2: OpenAI Vision Extractor

**Files:**
- Modify: `src/fits/pyfa-image-import.ts`
- Modify: `src/fits/pyfa-image-import.test.ts`

**Interfaces:**
- Consumes:
  - `PyfaScreenshotExtractor.extract(input)`
- Produces:
  - OpenAI-backed default extractor that posts to `https://api.openai.com/v1/responses`.

- [ ] **Step 1: Add failing provider payload test**

Extend `src/fits/pyfa-image-import.test.ts` with a test that sets `OPENAI_API_KEY`, stubs `globalThis.fetch`, calls `createDefaultPyfaScreenshotExtractor().extract(...)`, and asserts:

- request URL is `https://api.openai.com/v1/responses`
- authorization header uses `Bearer <key>`
- body includes `input_image` with `data:image/png;base64,AAAA`
- body includes a strict JSON schema response format
- returned `output_text` JSON is parsed into a `PyfaScreenshotExtraction`

- [ ] **Step 2: Run test to verify RED**

Run: `node --import tsx --test src/fits/pyfa-image-import.test.ts`

Expected: FAIL because the default extractor still only throws or returns a placeholder.

- [ ] **Step 3: Implement provider call**

In `src/fits/pyfa-image-import.ts`, implement the extractor using native `fetch`:

- model from `PYFA_IMAGE_IMPORT_MODEL`, defaulting to `gpt-5.6`.
- endpoint `https://api.openai.com/v1/responses`.
- image as `data:${mimeType};base64,${imageBase64}`.
- `input` with one user message containing `input_text` instructions and the `input_image`.
- `text.format` using `type: 'json_schema'`, `strict: true`, and a schema matching `PyfaScreenshotExtraction`.
- `store: false`.

Parse the returned response by looking for `output_text` first, then falling back to the first output message text content.

- [ ] **Step 4: Run unit test to verify GREEN**

Run: `node --import tsx --test src/fits/pyfa-image-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/fits/pyfa-image-import.ts src/fits/pyfa-image-import.test.ts
git commit -m "feat: extract pyfa screenshots with vision"
```

## Task 3: Backend Route

**Files:**
- Modify: `src/routes/fits.ts`
- Modify: `src/routes/fits.test.ts`

**Interfaces:**
- Consumes:
  - `validatePyfaImageInput(input)`
  - `renderPyfaExtractionToEft(extraction)`
  - `PyfaScreenshotExtractor`
- Produces:
  - `POST /api/fits/import-pyfa-image`

- [ ] **Step 1: Add failing route tests**

Add route tests that inject a fake extractor through `registerFitRoutes` dependencies and verify:

- unauthenticated request gets 401.
- invalid mime type gets 400 and does not call extractor.
- successful route returns `rawEft` and `warnings`.
- extractor throwing `pyfa_image_import_not_configured` returns a 503 with that error.

- [ ] **Step 2: Run test to verify RED**

Run: `node --import tsx --test src/routes/fits.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route**

Update the fit route dependency type to accept an optional `pyfaScreenshotExtractor`. Default to `createDefaultPyfaScreenshotExtractor()`. Add:

```ts
app.post('/api/fits/import-pyfa-image', async (req, reply) => {
  const currentUser = await requireUser(req, reply);
  if (!currentUser) return;
  try {
    const input = validatePyfaImageInput(req.body);
    const extraction = await pyfaScreenshotExtractor.extract({ ...input, userId: currentUser.id });
    return renderPyfaExtractionToEft(extraction);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to import pyfa screenshot.';
    const status = message === PYFA_IMAGE_IMPORT_NOT_CONFIGURED ? 503 : 400;
    return reply.code(status).send({ error: message });
  }
});
```

Use the route’s existing auth helper pattern rather than duplicating session parsing.

- [ ] **Step 4: Run route test to verify GREEN**

Run: `node --import tsx --test src/routes/fits.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/routes/fits.ts src/routes/fits.test.ts
git commit -m "feat: add pyfa image import route"
```

## Task 4: Frontend API and Import Modal

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/components/FitsView.tsx`
- Modify: `web/src/styles.css`
- Modify: `src/fits/import-modal-view.test.ts`

**Interfaces:**
- Consumes:
  - `POST /api/fits/import-pyfa-image`
- Produces:
  - `export async function importPyfaImage(input: PyfaImageImportRequest): Promise<PyfaImageImportResult | { error: string }>`

- [ ] **Step 1: Add failing frontend source test**

Update `src/fits/import-modal-view.test.ts` to assert:

- `FitsView.tsx` imports `importPyfaImage`.
- modal has `Paste EFT` and `pyfa Screenshot` mode controls.
- screenshot extraction writes generated `rawEft` into `setImportText`.
- generated screenshot warnings render in the modal.
- normal `Preview` still calls `previewFit(importText)`.

- [ ] **Step 2: Run test to verify RED**

Run: `node --import tsx --test src/fits/import-modal-view.test.ts`

Expected: FAIL because screenshot mode is absent.

- [ ] **Step 3: Add API helper**

In `web/src/api.ts`, add:

```ts
export interface PyfaImageImportRequest {
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface PyfaImageImportResult {
  rawEft: string;
  warnings: string[];
}

export async function importPyfaImage(input: PyfaImageImportRequest): Promise<PyfaImageImportResult | { error: string }> {
  return jsonOrError(await fetch('/api/fits/import-pyfa-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}
```

- [ ] **Step 4: Add modal UI**

In `FitsView.tsx`, add state:

```ts
const [importMode, setImportMode] = useState<'eft' | 'pyfa-image'>('eft');
const [pyfaImage, setPyfaImage] = useState<File | null>(null);
const [pyfaBusy, setPyfaBusy] = useState(false);
const [pyfaWarnings, setPyfaWarnings] = useState<string[]>([]);
const [pyfaNotice, setPyfaNotice] = useState<string | null>(null);
```

Add an `extractPyfaImage` helper that reads the selected file with `FileReader`, strips the data URL prefix, calls `importPyfaImage`, writes `res.rawEft` to `setImportText`, sets warnings/notice, and switches `setImportMode('eft')`.

Render segmented mode buttons above the textarea. In pyfa mode, render a drop/select area and an `Extract` button. In EFT mode, keep the existing textarea/actions and show the generated notice/warnings when present.

- [ ] **Step 5: Add CSS**

Add styles for:

- `.fits-import-tabs`
- `.fits-import-drop`
- `.fits-import-drop.dragging`
- `.fits-import-file`
- `.fits-import-note`
- `.fits-import-warnings`

Keep the modal compact and consistent with existing dark UI.

- [ ] **Step 6: Run frontend source test to verify GREEN**

Run: `node --import tsx --test src/fits/import-modal-view.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add web/src/api.ts web/src/components/FitsView.tsx web/src/styles.css src/fits/import-modal-view.test.ts
git commit -m "feat: add pyfa screenshot import UI"
```

## Task 5: Verification and Deployment Readiness

**Files:**
- No new source files expected.

**Interfaces:**
- Consumes all prior tasks.
- Produces confidence that the app builds and the existing import flow still works.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --import tsx --test src/fits/pyfa-image-import.test.ts src/fits/import-modal-view.test.ts src/routes/fits.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS with existing Postgres integration skips when `DATABASE_URL` and `TEST_DATABASE_URL` are not set.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Manual local check**

Run: `npm run dev` if not already running. Open the Fits import modal, switch to `pyfa Screenshot`, choose the provided screenshot, and confirm behavior. If `OPENAI_API_KEY` is not configured locally, verify the modal shows `pyfa_image_import_not_configured` and normal EFT paste import still works.

- [ ] **Step 5: Commit any verification-only adjustments**

If verification requires small fixes, commit them with a focused message. Do not commit generated `dist` assets unless the repo already tracks them.
