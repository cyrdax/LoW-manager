import { esiPost } from '../esi/client.ts';
import type { EsiFitFlag, FitDraft } from './types.ts';

const MAX_FITTING_NAME = 50;
const MAX_FITTING_ITEMS = 512;

export interface EsiFittingCreatePayload {
  name: string;
  description: string;
  ship_type_id: number;
  items: Array<{
    type_id: number;
    flag: EsiFitFlag;
    quantity: number;
  }>;
}

export function buildEsiFittingPayload(fit: FitDraft & { notes?: string }): EsiFittingCreatePayload {
  if (!fit.ship) throw new Error('Cannot export a fit without a resolved ship.');
  const items = fit.items
    .filter(item => item.typeId != null && item.slotFlag != null)
    .map(item => ({
      type_id: item.typeId!,
      flag: item.slotFlag!,
      quantity: isSingleItemFlag(item.slotFlag!) ? 1 : Math.max(1, item.quantity),
    }));

  if (items.length > MAX_FITTING_ITEMS) {
    throw new Error(`ESI fittings support at most ${MAX_FITTING_ITEMS} items.`);
  }

  return {
    name: fit.fitName.trim().slice(0, MAX_FITTING_NAME) || fit.ship.name.slice(0, MAX_FITTING_NAME),
    description: fit.notes ?? '',
    ship_type_id: fit.ship.typeId,
    items,
  };
}

export async function createCharacterFitting(
  characterId: number,
  payload: EsiFittingCreatePayload,
): Promise<number | null> {
  const { data } = await esiPost<number | { fitting_id?: number }>(
    `/characters/${characterId}/fittings/`,
    characterId,
    payload,
  );
  return typeof data === 'number' ? data : (data?.fitting_id ?? null);
}

function isSingleItemFlag(flag: EsiFitFlag): boolean {
  return flag.startsWith('LoSlot')
    || flag.startsWith('MedSlot')
    || flag.startsWith('HiSlot')
    || flag.startsWith('RigSlot')
    || flag.startsWith('ServiceSlot')
    || flag.startsWith('SubSystemSlot');
}
