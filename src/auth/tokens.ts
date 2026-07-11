import { createSqliteCharacterStore, type UpdateCharacterTokensInput } from '../characters/store.ts';
import type { CharacterRow } from '../types.ts';
import { refreshAccessToken as refreshAccessTokenDefault } from './sso.ts';

const REFRESH_BUFFER_MS = 2 * 60 * 1000;

type MaybePromise<T> = T | Promise<T>;

interface TokenCharacterStore {
  getById(characterId: number): MaybePromise<CharacterRow | undefined>;
  updateTokens(characterId: number, input: UpdateCharacterTokensInput): MaybePromise<CharacterRow | undefined>;
  markNeedsReauth(characterId: number): MaybePromise<boolean>;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: 'Bearer';
}

export interface AccessTokenProviderDeps {
  characters?: TokenCharacterStore;
  now?: () => number;
  refreshAccessToken?: (refreshToken: string) => Promise<TokenResponse>;
}

export function createAccessTokenProvider(deps: AccessTokenProviderDeps = {}) {
  const characters = deps.characters ?? createSqliteCharacterStore();
  const now = deps.now ?? (() => Date.now());
  const refreshAccessToken = deps.refreshAccessToken ?? refreshAccessTokenDefault;

  return async function getAccessTokenForCharacter(characterId: number): Promise<string> {
    const row = await characters.getById(characterId);
    if (!row) throw new Error(`Unknown character ${characterId}`);
    if (row.needs_reauth) throw new Error(`Character ${characterId} needs reauth`);

    const timestamp = now();
    if (row.access_token && row.access_token_expires_at && row.access_token_expires_at - timestamp > REFRESH_BUFFER_MS) {
      return row.access_token;
    }

    try {
      const tok = await refreshAccessToken(row.refresh_token);
      const expiresAt = timestamp + tok.expires_in * 1000;
      await characters.updateTokens(characterId, {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        accessTokenExpiresAt: expiresAt,
      });
      return tok.access_token;
    } catch (err) {
      // Only mark reauth on EVE's "token is dead" response (400 + invalid_grant).
      // Transient failures (5xx, network errors, rate limits) leave needs_reauth=0
      // so the next polling cycle can retry — otherwise a brief EVE hiccup forces
      // the user to re-login every character by hand.
      const msg = String((err as Error).message ?? '');
      if (/Refresh failed: 400\b/.test(msg) && /invalid_grant/.test(msg)) {
        await characters.markNeedsReauth(characterId);
      }
      throw err;
    }
  };
}

export const getAccessToken = createAccessTokenProvider();
