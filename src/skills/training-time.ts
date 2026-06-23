export interface CharacterAttributes {
  charisma: number;
  intelligence: number;
  memory: number;
  perception: number;
  willpower: number;
}

// Standard unmapped/no-implant-ish baseline. Real pilots use cached ESI attributes
// once available; this keeps estimates useful before the first attribute poll lands.
export const DEFAULT_CHARACTER_ATTRIBUTES: CharacterAttributes = {
  charisma: 19,
  intelligence: 20,
  memory: 20,
  perception: 20,
  willpower: 20,
};

const DOGMA_ATTRIBUTE_TO_FIELD: Record<number, keyof CharacterAttributes> = {
  164: 'charisma',
  165: 'intelligence',
  166: 'memory',
  167: 'perception',
  168: 'willpower',
};

const DEFAULT_SP_PER_HOUR = 1800;

export function trainingRateSpPerHour(
  primary: number | null | undefined,
  secondary: number | null | undefined,
  attributes: CharacterAttributes | null | undefined,
): number {
  const primaryField = primary == null ? null : DOGMA_ATTRIBUTE_TO_FIELD[primary];
  const secondaryField = secondary == null ? null : DOGMA_ATTRIBUTE_TO_FIELD[secondary];
  if (!primaryField || !secondaryField) return DEFAULT_SP_PER_HOUR;

  const attrs = attributes ?? DEFAULT_CHARACTER_ATTRIBUTES;
  const spPerMinute = attrs[primaryField] + attrs[secondaryField] / 2;
  return Math.max(1, spPerMinute * 60);
}

export function trainingSecondsForSp(
  spGap: number,
  primary: number | null | undefined,
  secondary: number | null | undefined,
  attributes: CharacterAttributes | null | undefined,
): number {
  if (spGap <= 0) return 0;
  return Math.ceil((spGap / trainingRateSpPerHour(primary, secondary, attributes)) * 3600);
}
