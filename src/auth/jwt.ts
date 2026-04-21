import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://login.eveonline.com/oauth/jwks'));

export interface EveJwtClaims extends JWTPayload {
  scp: string | string[];
  sub: string; // "CHARACTER:EVE:<character_id>"
  name: string;
  owner: string;
  exp: number;
  iss: string;
  aud: string | string[];
}

export async function verifyEveJwt(token: string): Promise<EveJwtClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ['login.eveonline.com', 'https://login.eveonline.com'],
    audience: 'EVE Online',
  });
  return payload as EveJwtClaims;
}

export function characterIdFromSub(sub: string): number {
  const parts = sub.split(':');
  const id = Number(parts[parts.length - 1]);
  if (!Number.isFinite(id)) throw new Error(`Bad sub: ${sub}`);
  return id;
}
