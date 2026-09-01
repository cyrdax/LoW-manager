export const PYFA_IMAGE_IMPORT_NOT_CONFIGURED = 'pyfa_image_import_not_configured';
export const DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const PYFA_IMAGE_IMPORT_REQUEST_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const SECTION_ORDER: PyfaCanonicalSectionRole[] = ['low', 'mid', 'high', 'rig', 'service', 'subsystem', 'extras'];
const EFT_SLOT_SECTION_ROLES = ['low', 'mid', 'high', 'rig'] as const satisfies readonly PyfaCanonicalSectionRole[];
const EFT_POST_RIG_SECTION_ROLES = ['service', 'subsystem', 'extras'] as const satisfies readonly PyfaCanonicalSectionRole[];
const EMPTY_SLOT_MARKERS: Record<(typeof EFT_SLOT_SECTION_ROLES)[number], string> = {
  low: '[Empty Low slot]',
  mid: '[Empty Med slot]',
  high: '[Empty High slot]',
  rig: '[Empty Rig slot]',
};
const IN_GAME_EXTRA_SECTION_ROLES: PyfaScreenshotSectionRole[] = ['charges', 'implantsBoosters', 'cargoModules', 'otherItems'];

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

export type PyfaCanonicalSectionRole = 'high' | 'mid' | 'low' | 'rig' | 'service' | 'subsystem' | 'extras';
export type PyfaScreenshotSectionRole =
  | PyfaCanonicalSectionRole
  | 'charges'
  | 'implantsBoosters'
  | 'cargoModules'
  | 'otherItems';

export interface PyfaScreenshotSection {
  role: PyfaScreenshotSectionRole;
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

export function validatePyfaImageInput(input: unknown, maxBytes = configuredMaxBytes()): PyfaScreenshotInput {
  if (!input || typeof input !== 'object') throw new Error('imageBase64 is required');
  const body = input as { imageBase64?: unknown; mimeType?: unknown };
  if (typeof body.imageBase64 !== 'string' || body.imageBase64.trim().length === 0) {
    throw new Error('imageBase64 is required');
  }
  if (!isSupportedMimeType(body.mimeType)) throw new Error('Unsupported image type.');

  const imageBase64 = stripDataUrlPrefix(body.imageBase64.trim());
  const bytes = Buffer.from(imageBase64, 'base64');
  if (bytes.length === 0) throw new Error('imageBase64 is required');
  if (bytes.length > maxBytes) throw new Error('Image is too large.');

  return { imageBase64, mimeType: body.mimeType };
}

export function renderPyfaExtractionToEft(extraction: PyfaScreenshotExtraction): { rawEft: string; warnings: string[] } {
  const shipName = cleanText(extraction.shipName ?? '');
  if (!shipName) throw new Error('Could not find a ship name in the screenshot.');
  const extractedFitName = cleanText(extraction.fitName ?? '');
  const fitName = extractedFitName || `${shipName} screenshot import`;
  const warnings = [...(extraction.warnings ?? [])];
  if (!extractedFitName) warnings.push(`Fit name was not readable; using "${fitName}".`);

  const lines: string[] = [`[${shipName}, ${fitName}]`];
  const itemsByRole = new Map<PyfaCanonicalSectionRole, PyfaScreenshotItem[]>();
  for (const section of extraction.sections) {
    const role = canonicalSectionRole(section.role);
    if (!role) continue;
    const items = section.items.filter(item => cleanText(item.name));
    if (items.length === 0) continue;
    itemsByRole.set(role, [...(itemsByRole.get(role) ?? []), ...items]);
  }
  if (itemsByRole.size === 0) throw new Error('Could not find visible fit items in the screenshot.');

  for (const role of EFT_SLOT_SECTION_ROLES) {
    lines.push('');
    const items = itemsByRole.get(role) ?? [];
    if (items.length === 0) {
      lines.push(EMPTY_SLOT_MARKERS[role]);
      continue;
    }
    for (const item of items) {
      lines.push(...renderFittedItemLines(item));
    }
  }

  for (const role of EFT_POST_RIG_SECTION_ROLES) {
    const items = itemsByRole.get(role) ?? [];
    if (items.length === 0) continue;
    lines.push('');
    for (const item of items) {
      if (role === 'extras') {
        const rendered = renderItemLine(item);
        if (rendered) lines.push(rendered);
      } else {
        lines.push(...renderFittedItemLines(item));
      }
    }
  }

  return {
    rawEft: lines.join('\n'),
    warnings,
  };
}

export function createDefaultPyfaScreenshotExtractor(): PyfaScreenshotExtractor {
  return {
    async extract(input) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error(PYFA_IMAGE_IMPORT_NOT_CONFIGURED);
      const model = process.env.PYFA_IMAGE_IMPORT_MODEL || 'gpt-5.6';
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: PYFA_IMAGE_IMPORT_PROMPT },
              { type: 'input_image', image_url: `data:${input.mimeType};base64,${input.imageBase64}` },
            ],
          }],
          text: {
            format: {
              type: 'json_schema',
              name: 'pyfa_screenshot_extraction',
              strict: true,
              schema: PYFA_EXTRACTION_SCHEMA,
            },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`pyfa_image_import_provider_failed_${response.status}`);
      }
      const body = await response.json();
      return parseOpenAIExtraction(body);
    },
  };
}

const PYFA_IMAGE_IMPORT_PROMPT = [
  'Extract only visible EVE fitting information from a Pyfa or in-game fitting screenshot.',
  'Return strict JSON matching the provided schema.',
  'For Pyfa, use the tab title like "Paladin: Fabricator" for shipName and fitName when visible.',
  'For an in-game window headed "Ship Fitting: <ship>", use <ship> as shipName and the Fitting Name field as fitName when readable; return null when the fitting name is blank or unreadable.',
  'Import fitted rows from visible High, Med, Low, Rig, Service, and Subsystem sections.',
  'For in-game screenshots, return Charges, Implants & Boosters, Modules, and Other Items with roles charges, implantsBoosters, cargoModules, and otherItems; preserve their visible quantities.',
  'Ignore numeric stats, prices, DPS, resources, resistances, and right-side panels.',
  'If a fitted row has a visible loaded charge, put it in loadedCharge without counts or cycle text.',
  'Treat rows under the in-game Charges heading as cargo items, not loadedCharge values.',
  'Import only the currently visible additions tab as extras; do not guess hidden tabs.',
  'Add warnings for cropped or uncertain rows instead of inventing item names.',
].join(' ');

const PYFA_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shipName: { type: ['string', 'null'] },
    fitName: { type: ['string', 'null'] },
    warnings: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: ['high', 'mid', 'low', 'rig', 'service', 'subsystem', 'extras', 'charges', 'implantsBoosters', 'cargoModules', 'otherItems'] },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                quantity: { type: ['number', 'null'] },
                loadedCharge: { type: ['string', 'null'] },
                confidence: { type: ['number', 'null'] },
              },
              required: ['name', 'quantity', 'loadedCharge', 'confidence'],
            },
          },
        },
        required: ['role', 'items'],
      },
    },
  },
  required: ['shipName', 'fitName', 'warnings', 'sections'],
};

function parseOpenAIExtraction(body: unknown): PyfaScreenshotExtraction {
  const outputText = extractOutputText(body);
  if (!outputText) throw new Error('pyfa_image_import_provider_empty_response');
  const parsed = JSON.parse(outputText);
  return coerceExtraction(parsed);
}

function extractOutputText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const response = body as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === 'string') return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const output of response.output) {
    if (!output || typeof output !== 'object') continue;
    const content = (output as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const maybeText = part as { text?: unknown; type?: unknown };
      if ((maybeText.type === 'output_text' || maybeText.type === 'text') && typeof maybeText.text === 'string') {
        return maybeText.text;
      }
    }
  }
  return null;
}

function coerceExtraction(value: unknown): PyfaScreenshotExtraction {
  if (!value || typeof value !== 'object') throw new Error('pyfa_image_import_provider_invalid_response');
  const raw = value as {
    shipName?: unknown;
    fitName?: unknown;
    warnings?: unknown;
    sections?: unknown;
  };
  const sections = Array.isArray(raw.sections)
    ? raw.sections.flatMap(section => coerceSection(section))
    : [];
  return {
    shipName: typeof raw.shipName === 'string' ? raw.shipName : null,
    fitName: typeof raw.fitName === 'string' ? raw.fitName : null,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((warning): warning is string => typeof warning === 'string') : [],
    sections,
  };
}

function coerceSection(value: unknown): PyfaScreenshotSection[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as { role?: unknown; items?: unknown };
  if (!isKnownSectionRole(raw.role)) return [];
  return [{
    role: raw.role,
    items: Array.isArray(raw.items) ? raw.items.flatMap(item => coerceItem(item)) : [],
  }];
}

function coerceItem(value: unknown): PyfaScreenshotItem[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as { name?: unknown; quantity?: unknown; loadedCharge?: unknown; confidence?: unknown };
  if (typeof raw.name !== 'string') return [];
  return [{
    name: raw.name,
    quantity: typeof raw.quantity === 'number' ? raw.quantity : undefined,
    loadedCharge: typeof raw.loadedCharge === 'string' ? raw.loadedCharge : null,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
  }];
}

function renderItemLine(item: PyfaScreenshotItem): string | null {
  const itemName = cleanText(item.name);
  if (!itemName) return null;
  const loadedCharge = cleanLoadedCharge(item.loadedCharge);
  const quantity = Number.isFinite(item.quantity) && item.quantity != null && item.quantity > 1
    ? ` x${Math.floor(item.quantity)}`
    : '';
  return loadedCharge ? `${itemName}, ${loadedCharge}${quantity}` : `${itemName}${quantity}`;
}

function renderFittedItemLines(item: PyfaScreenshotItem): string[] {
  const itemName = cleanText(item.name);
  if (!itemName) return [];
  const loadedCharge = cleanLoadedCharge(item.loadedCharge);
  const line = loadedCharge ? `${itemName}, ${loadedCharge}` : itemName;
  const quantity = Number.isFinite(item.quantity) && item.quantity != null && item.quantity > 1
    ? Math.floor(item.quantity)
    : 1;
  return Array.from({ length: quantity }, () => line);
}

function cleanLoadedCharge(value: string | null | undefined): string | null {
  const cleaned = cleanText(value ?? '').replace(/\s+\([^)]*\)\s*$/, '').trim();
  return cleaned || null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1).trim() : value;
}

function configuredMaxBytes(): number {
  const raw = process.env.PYFA_IMAGE_IMPORT_MAX_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES;
}

function isSupportedMimeType(value: unknown): value is PyfaImageMimeType {
  return typeof value === 'string' && SUPPORTED_MIME_TYPES.includes(value as PyfaImageMimeType);
}

function isKnownSectionRole(value: unknown): value is PyfaScreenshotSection['role'] {
  return typeof value === 'string'
    && (SECTION_ORDER.includes(value as PyfaCanonicalSectionRole)
      || IN_GAME_EXTRA_SECTION_ROLES.includes(value as PyfaScreenshotSectionRole));
}

function canonicalSectionRole(role: PyfaScreenshotSectionRole): PyfaCanonicalSectionRole | null {
  if (SECTION_ORDER.includes(role as PyfaCanonicalSectionRole)) return role as PyfaCanonicalSectionRole;
  if (IN_GAME_EXTRA_SECTION_ROLES.includes(role)) return 'extras';
  return null;
}
