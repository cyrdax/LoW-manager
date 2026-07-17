import { esiGet } from './client.ts';

export interface EsiCharacterAsset {
  item_id: number;
  type_id: number;
  quantity: number;
  location_id: number;
  location_type: 'station' | 'solar_system' | 'item' | 'other';
  location_flag: string;
  is_singleton: boolean;
  is_blueprint_copy?: boolean;
}

export async function getCharacterAssets(characterId: number): Promise<EsiCharacterAsset[]> {
  const first = await esiGet<EsiCharacterAsset[]>(`/characters/${characterId}/assets/?page=1`, characterId);
  const assets = [...first.data];
  const pages = first.pages ?? 1;

  for (let page = 2; page <= pages; page++) {
    const { data } = await esiGet<EsiCharacterAsset[]>(`/characters/${characterId}/assets/?page=${page}`, characterId);
    assets.push(...data);
  }

  return assets;
}
