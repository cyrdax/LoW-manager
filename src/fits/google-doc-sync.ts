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
import { buildFitDraft } from './assignment.ts';

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
  tabId?: string;
  tabTitle?: string;
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

export interface GoogleDocTabText {
  id: string;
  title: string;
  sortOrder: number;
  text: string;
}

export interface DoctrineTabFitSyncInput {
  doctrine: DoctrineDetail;
  fitStore: FitStore | AsyncFitStore;
  doctrineStore: DoctrineStore | AsyncDoctrineStore;
  tabs: GoogleDocTabText[];
  ownerUserId: string;
}

const EFT_HEADER = /^\s*\[([^,\]]+),\s*([^\]]+)\]\s*$/;
const GOOGLE_DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/;

export function googleDocTextExportUrl(url: string): string | null {
  const match = GOOGLE_DOC_URL.exec(url.trim());
  return match ? `https://docs.google.com/document/d/${match[1]}/export?format=txt` : null;
}

export function googleDocApiUrl(url: string, apiKey?: string): string | null {
  const match = GOOGLE_DOC_URL.exec(url.trim());
  if (!match) return null;
  const params = new URLSearchParams({ includeTabsContent: 'true' });
  if (apiKey?.trim()) params.set('key', apiKey.trim());
  return `https://docs.googleapis.com/v1/documents/${match[1]}?${params.toString()}`;
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

export function extractGoogleDocTabs(document: unknown): GoogleDocTabText[] {
  const root = isRecord(document) && Array.isArray(document.tabs) ? document.tabs : [];
  const tabs: GoogleDocTabText[] = [];
  walkGoogleDocTabs(root, tabs, 0);
  return tabs.filter(tab => tab.text.trim());
}

export async function syncDoctrineFitsFromTabs(input: DoctrineTabFitSyncInput): Promise<DoctrineFitSyncResult> {
  let doctrine = input.doctrine;
  const result: DoctrineFitSyncResult = {
    doctrine,
    updated: [],
    created: [],
    skipped: [],
    ambiguous: [],
    failed: [],
  };

  if (input.tabs.length === 0) {
    result.skipped.push({ fitName: '', reason: 'No Google Doc tabs found.' });
    return result;
  }

  for (const tab of input.tabs) {
    const blocks = extractEftBlocksFromText(tab.text);
    if (blocks.length === 0) {
      const replaced = await input.doctrineStore.replaceTabFits(doctrine.id, tab, []);
      if (replaced) doctrine = replaced;
      result.skipped.push({ fitName: tab.title, reason: 'No EFT fit blocks found in tab.' });
      continue;
    }

    const tabFitIds: number[] = [];
    for (const block of blocks) {
      const matches = doctrine.fits.filter(fit =>
        fit.googleDocTabId === tab.id && normalizeFitName(fit.fitName) === normalizeFitName(block.fitName),
      );
      if (matches.length > 1) {
        result.ambiguous.push({ fitName: `${tab.title}: ${block.fitName}`, matchedFitIds: matches.map(fit => fit.id) });
        continue;
      }

      try {
        if (matches.length === 1) {
          const updated = await input.fitStore.update(matches[0].id, updateInputForBlock(block));
          if (!updated?.ship) {
            result.failed.push({ fitName: block.fitName, error: 'Updated fit could not be loaded.' });
            continue;
          }
          tabFitIds.push(updated.id);
          result.updated.push(entryFor(updated, tab));
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
          tabFitIds.push(created.id);
          result.created.push(entryFor(created, tab));
        }
      } catch (err) {
        result.failed.push({ fitName: block.fitName, error: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      const replaced = await input.doctrineStore.replaceTabFits(doctrine.id, tab, tabFitIds);
      if (replaced) doctrine = replaced;
    } catch (err) {
      result.failed.push({ fitName: tab.title, error: err instanceof Error ? err.message : String(err) });
    }
  }

  result.doctrine = doctrine;
  return result;
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
        const updated = await input.fitStore.update(matches[0].id, updateInputForBlock(block));
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

function walkGoogleDocTabs(rawTabs: unknown[], out: GoogleDocTabText[], baseOrder: number): void {
  rawTabs.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const props = isRecord(raw.tabProperties) ? raw.tabProperties : {};
    const id = typeof props.tabId === 'string' && props.tabId.trim() ? props.tabId.trim() : `tab-${baseOrder + index + 1}`;
    const title = typeof props.title === 'string' && props.title.trim() ? props.title.trim() : id;
    const rawIndex = typeof props.index === 'number' ? props.index : index;
    const sortOrder = baseOrder + rawIndex;
    if (isRecord(raw.documentTab)) {
      out.push({ id, title, sortOrder, text: extractGoogleDocBodyText(raw.documentTab) });
    }
    if (Array.isArray(raw.childTabs)) walkGoogleDocTabs(raw.childTabs, out, sortOrder * 1000);
  });
}

function extractGoogleDocBodyText(documentTab: Record<string, unknown>): string {
  const body = isRecord(documentTab.body) ? documentTab.body : {};
  const content = Array.isArray(body.content) ? body.content : [];
  return content.map(extractStructuralElementText).join('');
}

function extractStructuralElementText(element: unknown): string {
  if (!isRecord(element)) return '';
  if (isRecord(element.paragraph)) {
    const elements = Array.isArray(element.paragraph.elements) ? element.paragraph.elements : [];
    return elements.map(extractParagraphElementText).join('');
  }
  if (isRecord(element.table)) {
    const rows = Array.isArray(element.table.tableRows) ? element.table.tableRows : [];
    return rows.map(row => {
      if (!isRecord(row) || !Array.isArray(row.tableCells)) return '';
      return row.tableCells.map(cell => {
        if (!isRecord(cell) || !Array.isArray(cell.content)) return '';
        return cell.content.map(extractStructuralElementText).join('');
      }).join('\n');
    }).join('\n');
  }
  if (isRecord(element.tableOfContents)) {
    const content = Array.isArray(element.tableOfContents.content) ? element.tableOfContents.content : [];
    return content.map(extractStructuralElementText).join('');
  }
  return '';
}

function extractParagraphElementText(element: unknown): string {
  if (!isRecord(element) || !isRecord(element.textRun)) return '';
  return typeof element.textRun.content === 'string' ? element.textRun.content : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function updateInputForBlock(block: ParsedEftBlock): { rawEft: string; shipTypeId?: number } {
  const draft = buildFitDraft(block.rawEft);
  return draft.ship ? { rawEft: block.rawEft, shipTypeId: draft.ship.typeId } : { rawEft: block.rawEft };
}

function entryFor(fit: SavedFitDetail, tab?: GoogleDocTabText): DoctrineFitSyncEntry {
  return {
    fitId: fit.id,
    fitName: fit.fitName,
    shipName: fit.ship?.name ?? fit.headerShipName,
    ...(tab ? { tabId: tab.id, tabTitle: tab.title } : {}),
  };
}
