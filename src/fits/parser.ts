import type { ParsedFitLine, ParsedFitSection, ParsedFitText, RenderEftInput } from './types.ts';

const HEADER_RE = /^\s*\[(.+)\]\s*$/;
const QUANTITY_RE = /\s+x([\d,]+)\s*$/i;

export function parseEftFit(rawEft: string): ParsedFitText {
  const normalized = rawEft.replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('Paste an EFT fit to import.');

  const rawLines = normalized.split('\n');
  const headerIndexes = rawLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => HEADER_RE.test(line));
  if (headerIndexes.length === 0) throw new Error('EFT fit header is required.');
  if (headerIndexes.length > 1) throw new Error('Import one fit at a time.');

  const headerMatch = HEADER_RE.exec(headerIndexes[0].line);
  const headerBody = headerMatch?.[1] ?? '';
  const commaIndex = headerBody.indexOf(',');
  if (commaIndex < 0) throw new Error('EFT fit header must be [Ship Hull, Fit Name].');

  const shipName = headerBody.slice(0, commaIndex).trim();
  const fitName = headerBody.slice(commaIndex + 1).trim();
  if (!shipName || !fitName) throw new Error('EFT fit header must include ship and fit name.');

  const sections: ParsedFitSection[] = [];
  let current: ParsedFitSection | null = null;

  for (let i = headerIndexes[0].index + 1; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      current = null;
      continue;
    }
    if (HEADER_RE.test(trimmed)) throw new Error('Import one fit at a time.');

    if (!current) {
      current = {
        sectionIndex: sections.length,
        startLineIndex: i,
        lines: [],
      };
      sections.push(current);
    }

    current.lines.push(parseItemLine(trimmed, i, current.sectionIndex));
  }

  const lines = sections.flatMap(section => section.lines);
  if (lines.length === 0) throw new Error('EFT fit contains no parseable items.');

  return {
    rawEft: normalized,
    header: {
      rawLine: headerIndexes[0].line.trim(),
      lineIndex: headerIndexes[0].index,
      shipName,
      fitName,
    },
    sections,
    lines,
  };
}

export function renderEftFit(input: RenderEftInput): string {
  const lines: string[] = [`[${input.shipName}, ${input.fitName}]`];
  const bySection = new Map<number, ParsedFitLine[]>();
  for (const line of input.lines) {
    const rows = bySection.get(line.sectionIndex) ?? [];
    rows.push(line);
    bySection.set(line.sectionIndex, rows);
  }

  const sectionIndexes = [...bySection.keys()].sort((a, b) => a - b);
  for (const sectionIndex of sectionIndexes) {
    lines.push('');
    const rows = bySection.get(sectionIndex)!.sort((a, b) => a.lineIndex - b.lineIndex);
    for (const row of rows) lines.push(renderLine(row));
  }

  return lines.join('\n');
}

function parseItemLine(rawLine: string, lineIndex: number, sectionIndex: number): ParsedFitLine {
  let body = rawLine;
  let quantity = 1;
  const qtyMatch = QUANTITY_RE.exec(body);
  if (qtyMatch) {
    quantity = Number(qtyMatch[1].replace(/,/g, ''));
    body = body.slice(0, qtyMatch.index).trim();
  }

  const commaIndex = body.indexOf(',');
  const itemName = (commaIndex >= 0 ? body.slice(0, commaIndex) : body).trim();
  const loadedChargeName = commaIndex >= 0 ? body.slice(commaIndex + 1).trim() : null;
  if (!itemName) throw new Error(`Line ${lineIndex + 1} is missing an item name.`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Line ${lineIndex + 1} has an invalid quantity.`);

  return {
    sectionIndex,
    lineIndex,
    rawLine,
    itemName,
    quantity,
    loadedChargeName: loadedChargeName || null,
  };
}

function renderLine(line: ParsedFitLine): string {
  const base = line.loadedChargeName ? `${line.itemName}, ${line.loadedChargeName}` : line.itemName;
  return line.quantity === 1 ? base : `${base} x${line.quantity}`;
}
