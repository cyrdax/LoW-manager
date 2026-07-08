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

export interface PublicContractPageResult {
  data: PublicContractSummary[];
  pages: number;
  expiresAt: number;
}

export interface PublicContractItemsResult {
  data: PublicContractItem[];
  expiresAt: number;
}

function expiry(expires: number | null): number {
  return expires && Number.isFinite(expires) ? expires : Date.now() + FALLBACK_TTL_MS;
}

export async function getPublicContracts(
  regionId: number,
  page = 1,
  signal?: AbortSignal,
): Promise<PublicContractPageResult> {
  const key = `${regionId}:${page}`;
  const hit = contractPageCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { data: hit.data, pages: hit.pages ?? 1, expiresAt: hit.expiresAt };
  }

  const res = await esiGetPublic<PublicContractSummary[]>(`/contracts/public/${regionId}/?page=${page}`, { signal });
  const pages = res.pages ?? 1;
  const expiresAt = expiry(res.expires);
  contractPageCache.set(key, { data: res.data, expiresAt, pages });
  return { data: res.data, pages, expiresAt };
}

export async function getPublicContractItems(contractId: number, signal?: AbortSignal): Promise<PublicContractItem[]> {
  return (await getPublicContractItemsPage(contractId, signal)).data;
}

export async function getPublicContractItemsPage(
  contractId: number,
  signal?: AbortSignal,
): Promise<PublicContractItemsResult> {
  const hit = contractItemsCache.get(contractId);
  if (hit && hit.expiresAt > Date.now()) return { data: hit.data, expiresAt: hit.expiresAt };

  const res = await esiGetPublic<PublicContractItem[]>(`/contracts/public/items/${contractId}/`, { signal });
  const expiresAt = expiry(res.expires);
  contractItemsCache.set(contractId, { data: res.data, expiresAt });
  return { data: res.data, expiresAt };
}
