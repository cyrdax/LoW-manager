import { esiGet } from './client.ts';

export const getWallet = (id: number) => esiGet<number>(`/characters/${id}/wallet/`, id);
