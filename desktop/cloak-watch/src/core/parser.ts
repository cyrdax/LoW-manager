import type { DecloakContext, DecloakEvent, ParsedLogEntry } from './types.js';

const EXCLUSIONS = [
  /fails? to activate/i,
  /unable to activate/i,
  /cannot cloak/i,
  /still recovering/i,
  /preventing your systems from functioning/i,
];

const DECLOAK_PATTERNS = [
  /\bde[ -]?cloak(?:ed|ing)?\b/i,
  /\bcloak(?:ing|ing device)?\b.*\b(?:deactivat|forcibly disrupt|forcibly disable)/i,
  /\b(?:deactivat|forcibly disrupt|forcibly disable).*\bcloak/i,
];

const LOG_ENTRY_PATTERN = /^\[\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\]\s+\(\s*([^)]+?)\s*\)\s+(.+)\s*$/;
const EVE_TAG_PATTERN = /<\/?[a-z][^>]*>/gi;
const ENTITY_REPLACEMENTS: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
};

export function parseListener(line: string): string | null {
  const match = /^\s*Listener:\s*(.+?)\s*$/.exec(line);
  return match?.[1] ?? null;
}

export function parseLogEntry(line: string): ParsedLogEntry | null {
  const match = LOG_ENTRY_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, category, message] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() !== month - 1 ||
    timestamp.getUTCDate() !== day ||
    timestamp.getUTCHours() !== hour ||
    timestamp.getUTCMinutes() !== minute ||
    timestamp.getUTCSeconds() !== second
  ) {
    return null;
  }

  return {
    occurredAt: timestamp.toISOString(),
    category,
    message: sanitizeEveMessage(message),
  };
}

export function sanitizeEveMessage(message: string): string {
  return message
    .replace(EVE_TAG_PATTERN, '')
    .replace(/&(lt|gt|amp|quot);/g, (entity) => ENTITY_REPLACEMENTS[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

export function toDecloakEvent(
  entry: ParsedLogEntry | null,
  context: DecloakContext,
): DecloakEvent | null {
  if (!entry) {
    return null;
  }

  const message = sanitizeEveMessage(entry.message);
  if (EXCLUSIONS.some((pattern) => pattern.test(message))) {
    return null;
  }

  if (!DECLOAK_PATTERNS.some((pattern) => pattern.test(message))) {
    return null;
  }

  return {
    characterName: context.characterName ?? 'Unknown EVE client',
    occurredAt: entry.occurredAt,
    message,
    sourceFile: context.sourceFile,
    byteOffset: context.byteOffset,
  };
}
