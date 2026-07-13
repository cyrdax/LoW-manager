export const PYFA_IMAGE_IMPORT_NOT_CONFIGURED = 'pyfa_image_import_not_configured';
export const DEFAULT_PYFA_IMAGE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const SECTION_ORDER: PyfaScreenshotSection['role'][] = ['high', 'mid', 'low', 'rig', 'service', 'subsystem', 'extras'];

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
  const fitName = cleanText(extraction.fitName ?? '');
  if (!shipName) throw new Error('Could not find a ship name in the screenshot.');
  if (!fitName) throw new Error('Could not find a fit name in the screenshot.');

  const lines: string[] = [`[${shipName}, ${fitName}]`];
  const sections = [...extraction.sections]
    .filter(section => section.items.some(item => cleanText(item.name)))
    .sort((a, b) => SECTION_ORDER.indexOf(a.role) - SECTION_ORDER.indexOf(b.role));

  if (sections.length === 0) throw new Error('Could not find visible fit items in the screenshot.');

  for (const section of sections) {
    lines.push('');
    for (const item of section.items) {
      const rendered = renderItemLine(item);
      if (rendered) lines.push(rendered);
    }
  }

  return {
    rawEft: lines.join('\n'),
    warnings: [...(extraction.warnings ?? [])],
  };
}

export function createDefaultPyfaScreenshotExtractor(): PyfaScreenshotExtractor {
  return {
    async extract() {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error(PYFA_IMAGE_IMPORT_NOT_CONFIGURED);
      throw new Error('pyfa_image_import_provider_not_implemented');
    },
  };
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
