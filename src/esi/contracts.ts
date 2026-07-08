import { esiGetPublic } from './client.ts';
import type { PublicContractItem, PublicContractSummary } from '../contracts/types.ts';

interface CacheSlot<T> {
  data: T;
  expiresAt: number;
  pages?: number | null;
}

const FALLBACK_TTL_MS = 5 * 60 * 1000;
const contractPageCache = new Map<string, CacheSlot<PublicContractSummary[]>>();
const contractItemsCache = new Map<number, CacheSlot<PublicContractItem[]>>();

function expiry(expires: number | null): number {
  return expires && Number.isFinite(expires) ? expires : Date.now() + FALLBACK_TTL_MS;
}

export async function getPublicContracts(
  regionId: number,
  page = 1,
): Promise<{ data: PublicContractSummary[]; pages: number }> {
  const key = `${regionId}:${page}`;
  const hit = contractPageCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { data: hit.data, pages: hit.pages ?? 1 };
  }

  const res = await esiGetPublic<PublicContractSummary[]>(`/contracts/public/${regionId}/?page=${page}`);
  const pages = res.pages ?? 1;
  contractPageCache.set(key, { data: res.data, expiresAt: expiry(res.expires), pages });
  return { data: res.data, pages };
}

export async function getPublicContractItems(contractId: number): Promise<PublicContractItem[]> {
  const hit = contractItemsCache.get(contractId);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const res = await esiGetPublic<PublicContractItem[]>(`/contracts/public/items/${contractId}/`);
  contractItemsCache.set(contractId, { data: res.data, expiresAt: expiry(res.expires) });
  return res.data;
}
