import { resolveItemByName } from './metadata.ts';

export interface ParsedEftBlock {
  shipName: string;
  fitName: string;
  rawEft: string;
  startLine: number;
}

const EFT_HEADER = /^\s*\[([^,\]]+),\s*([^\]]+)\]\s*$/;
const QUANTITY_SUFFIX = /\s+x[\d,]+\s*$/i;

export function extractEftBlocksFromText(text: string): ParsedEftBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ParsedEftBlock[] = [];
  let current: { shipName: string; fitName: string; startLine: number; lines: string[]; hasFitLine: boolean; afterBlank: boolean } | null = null;

  lines.forEach((line, index) => {
    const header = EFT_HEADER.exec(line);
    if (header) {
      if (current) blocks.push(finishBlock(current));
      current = {
        shipName: header[1].trim(),
        fitName: header[2].trim(),
        startLine: index + 1,
        lines: [line.trim()],
        hasFitLine: false,
        afterBlank: false,
      };
      return;
    }
    if (!current) return;
    if (!line.trim()) {
      current.lines.push(line);
      current.afterBlank = true;
      return;
    }
    if (current.hasFitLine && current.afterBlank && !looksLikeEftItemLine(line)) {
      blocks.push(finishBlock(current));
      current = null;
      return;
    }
    current.lines.push(line);
    current.hasFitLine = current.hasFitLine || looksLikeEftItemLine(line);
    current.afterBlank = false;
  });

  if (current) blocks.push(finishBlock(current));
  return blocks.filter(block => block.shipName && block.fitName && block.rawEft.trim());
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

function looksLikeEftItemLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const body = trimmed.replace(QUANTITY_SUFFIX, '').trim();
  const commaIndex = body.indexOf(',');
  const itemName = (commaIndex >= 0 ? body.slice(0, commaIndex) : body).trim();
  const chargeName = commaIndex >= 0 ? body.slice(commaIndex + 1).trim() : '';
  if (!itemName) return false;
  if (resolveItemByName(itemName)) return true;
  return !!chargeName && !!resolveItemByName(chargeName);
}
