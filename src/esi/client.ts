import { getAccessToken } from '../auth/tokens.ts';

const BASE = 'https://esi.evetech.net/latest';

let errorLimitRemain = 100;
let errorLimitResetAt = 0;

export interface EsiResponse<T> {
  data: T;
  status: number;
  expires: number | null;
  etag: string | null;
}

function userAgent(): string {
  const contact = process.env.CONTACT_EMAIL ?? 'unknown';
  return `eve-fleet-dashboard/0.1 (${contact})`;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function esiFetch<T>(path: string, init: RequestInit = {}): Promise<EsiResponse<T>> {
  if (errorLimitRemain < 20 && Date.now() < errorLimitResetAt) {
    await sleep(errorLimitResetAt - Date.now() + 500);
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'User-Agent': userAgent(),
      'Accept': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const remain = res.headers.get('X-Esi-Error-Limit-Remain');
  const reset = res.headers.get('X-Esi-Error-Limit-Reset');
  if (remain) errorLimitRemain = Number(remain);
  if (reset) errorLimitResetAt = Date.now() + Number(reset) * 1000;

  const expiresHeader = res.headers.get('Expires');
  const expires = expiresHeader ? Date.parse(expiresHeader) : null;

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`ESI ${res.status} ${path}: ${body}`) as Error & { status: number; body: string };
    err.status = res.status;
    err.body = body;
    throw err;
  }

  const hasBody = res.status !== 204 && res.status !== 205 && res.headers.get('Content-Length') !== '0';
  const data = hasBody ? ((await res.json()) as T) : (undefined as T);
  return { data, status: res.status, expires, etag: res.headers.get('ETag') };
}

export async function esiGet<T>(path: string, characterId: number): Promise<EsiResponse<T>> {
  const token = await getAccessToken(characterId);
  return esiFetch<T>(path, { headers: { Authorization: `Bearer ${token}` } });
}

export async function esiPost<T>(path: string, characterId: number, body?: unknown): Promise<EsiResponse<T>> {
  const token = await getAccessToken(characterId);
  const hasBody = body !== undefined;
  return esiFetch<T>(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

export async function esiPut<T>(path: string, characterId: number, body: unknown): Promise<EsiResponse<T>> {
  const token = await getAccessToken(characterId);
  return esiFetch<T>(path, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function esiDelete<T = void>(path: string, characterId: number): Promise<EsiResponse<T>> {
  const token = await getAccessToken(characterId);
  return esiFetch<T>(path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function esiGetPublic<T>(path: string): Promise<EsiResponse<T>> {
  return esiFetch<T>(path);
}

export async function esiPostPublic<T>(path: string, body: unknown): Promise<EsiResponse<T>> {
  return esiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
