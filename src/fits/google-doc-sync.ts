import type {
  AsyncDoctrineStore,
  DoctrineDetail,
  DoctrineStore,
} from './doctrines.ts';
import type {
  AsyncFitStore,
  FitStore,
  LibraryVisibility,
  SavedFitDetail,
} from './store.ts';

export interface ParsedEftBlock {
  shipName: string;
  fitName: string;
  rawEft: string;
  startLine: number;
}

export interface DoctrineFitSyncEntry {
  fitId: number;
  fitName: string;
  shipName: string;
}

export interface DoctrineFitSyncResult {
  doctrine: DoctrineDetail;
  updated: DoctrineFitSyncEntry[];
  created: DoctrineFitSyncEntry[];
  skipped: Array<{ fitName: string; reason: string }>;
  ambiguous: Array<{ fitName: string; matchedFitIds: number[] }>;
  failed: Array<{ fitName: string; error: string }>;
}

export interface DoctrineFitSyncInput {
  doctrine: DoctrineDetail;
  fitStore: FitStore | AsyncFitStore;
  doctrineStore: DoctrineStore | AsyncDoctrineStore;
  rawText: string;
  ownerUserId: string;
}

const EFT_HEADER = /^\s*\[([^,\]]+),\s*([^\]]+)\]\s*$/;
const GOOGLE_DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/;

export function googleDocTextExportUrl(url: string): string | null {
  const match = GOOGLE_DOC_URL.exec(url.trim());
  return match ? `https://docs.google.com/document/d/${match[1]}/export?format=txt` : null;
}

export function extractEftBlocksFromText(text: string): ParsedEftBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ParsedEftBlock[] = [];
  let current: { shipName: string; fitName: string; startLine: number; lines: string[] } | null = null;

  lines.forEach((line, index) => {
    const header = EFT_HEADER.exec(line);
    if (header) {
      if (current) blocks.push(finishBlock(current));
      current = {
        shipName: header[1].trim(),
        fitName: header[2].trim(),
        startLine: index + 1,
        lines: [line.trim()],
      };
      return;
    }
    if (current) current.lines.push(line);
  });

  if (current) blocks.push(finishBlock(current));
  return blocks.filter(block => block.shipName && block.fitName && block.rawEft.trim());
}

export async function syncDoctrineFitsFromText(input: DoctrineFitSyncInput): Promise<DoctrineFitSyncResult> {
  const blocks = extractEftBlocksFromText(input.rawText);
  let doctrine = input.doctrine;
  const result: DoctrineFitSyncResult = {
    doctrine,
    updated: [],
    created: [],
    skipped: [],
    ambiguous: [],
    failed: [],
  };

  if (blocks.length === 0) {
    result.skipped.push({ fitName: '', reason: 'No EFT fit blocks found.' });
    return result;
  }

  for (const block of blocks) {
    const matches = doctrine.fits.filter(fit => normalizeFitName(fit.fitName) === normalizeFitName(block.fitName));
    if (matches.length > 1) {
      result.ambiguous.push({ fitName: block.fitName, matchedFitIds: matches.map(fit => fit.id) });
      continue;
    }

    try {
      if (matches.length === 1) {
        const updated = await input.fitStore.update(matches[0].id, { rawEft: block.rawEft });
        if (!updated?.ship) {
          result.failed.push({ fitName: block.fitName, error: 'Updated fit could not be loaded.' });
          continue;
        }
        result.updated.push(entryFor(updated));
      } else {
        const created = await input.fitStore.create({
          rawEft: block.rawEft,
          fitName: block.fitName,
          ownerUserId: doctrine.ownerUserId ?? input.ownerUserId,
          visibility: doctrine.visibility as LibraryVisibility,
        });
        if (!created.ship) {
          result.failed.push({ fitName: block.fitName, error: 'Created fit has no resolved ship.' });
          continue;
        }
        const nextDoctrine = await input.doctrineStore.addFit(doctrine.id, created.id);
        if (!nextDoctrine) {
          result.failed.push({ fitName: block.fitName, error: 'Created fit could not be added to doctrine.' });
          continue;
        }
        doctrine = nextDoctrine;
        result.created.push(entryFor(created));
      }
    } catch (err) {
      result.failed.push({ fitName: block.fitName, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const refreshed = await input.doctrineStore.get(doctrine.id);
    if (refreshed) doctrine = refreshed;
  }

  result.doctrine = doctrine;
  return result;
}

export function normalizeFitName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function finishBlock(block: { shipName: string; fitName: string; startLine: number; lines: string[] }): ParsedEftBlock {
  return {
    shipName: block.shipName,
    fitName: block.fitName,
    startLine: block.startLine,
    rawEft: trimBlankEdges(block.lines).join('\n'),
  };
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function entryFor(fit: SavedFitDetail): DoctrineFitSyncEntry {
  return {
    fitId: fit.id,
    fitName: fit.fitName,
    shipName: fit.ship?.name ?? fit.headerShipName,
  };
}
