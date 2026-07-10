export interface ParsedShoppingLine {
  name: string;
  qty: number;
  raw: string;
  ok: boolean;
}

export interface ShoppingListItem {
  name: string;
  qty: number;
}

export function parseShoppingList(text: string): ParsedShoppingLine[] {
  return text
    .split(/\r?\n/)
    .map(parseShoppingLine)
    .filter((line): line is ParsedShoppingLine => line != null);
}

export function aggregateShoppingItems(lines: ParsedShoppingLine[]): ShoppingListItem[] {
  const byName = new Map<string, ShoppingListItem>();

  for (const line of lines) {
    if (!line.ok) continue;
    const existing = byName.get(line.name);
    if (existing) existing.qty += line.qty;
    else byName.set(line.name, { name: line.name, qty: line.qty });
  }

  return [...byName.values()];
}

function parseShoppingLine(raw: string): ParsedShoppingLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let match = trimmed.match(/^(.+?)\t+(\d[\d,]*)\b/);
  if (match) {
    return line(match[1], quantity(match[2]), trimmed);
  }

  match = trimmed.match(/^(\d[\d,]*)\s*[x×]?\s+(.+)$/i);
  if (match) {
    return line(match[2], quantity(match[1]), trimmed);
  }

  match = trimmed.match(/^(.+?)\s+[x×]\s*(\d[\d,]*)$/i);
  if (match) {
    return line(match[1], quantity(match[2]), trimmed);
  }

  return line(trimmed, 1, trimmed);
}

function line(name: string, qty: number, raw: string): ParsedShoppingLine {
  const trimmedName = name.trim();
  return { name: trimmedName, qty, raw, ok: trimmedName.length > 0 && qty > 0 };
}

function quantity(raw: string): number {
  return Math.floor(Number(raw.replace(/,/g, '')) || 0);
}
