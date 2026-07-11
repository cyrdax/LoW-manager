import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessTokenProvider, setAccessTokenCharacterStore } from './tokens.ts';
import type { CharacterRow } from '../types.ts';

test('AccessTokenProvider returns a cached token that is not near expiry', async () => {
  const characters = new FakeTokenCharacters({
    access_token: 'cached-token',
    access_token_expires_at: 200_000,
  });
  const getAccessToken = createAccessTokenProvider({
    characters,
    now: () => 1_000,
    refreshAccessToken: async () => {
      throw new Error('should not refresh');
    },
  });

  assert.equal(await getAccessToken(101), 'cached-token');
  assert.equal(characters.updated.length, 0);
});

test('AccessTokenProvider refreshes stale tokens through the character store', async () => {
  const characters = new FakeTokenCharacters({
    access_token: 'stale-token',
    access_token_expires_at: 1_100,
  });
  const getAccessToken = createAccessTokenProvider({
    characters,
    now: () => 1_000,
    refreshAccessToken: async refreshToken => {
      assert.equal(refreshToken, 'refresh-old');
      return {
        access_token: 'fresh-token',
        refresh_token: 'refresh-new',
        expires_in: 60,
        token_type: 'Bearer',
      };
    },
  });

  assert.equal(await getAccessToken(101), 'fresh-token');
  assert.deepEqual(characters.updated, [{
    characterId: 101,
    refreshToken: 'refresh-new',
    accessToken: 'fresh-token',
    accessTokenExpiresAt: 61_000,
  }]);
});

test('AccessTokenProvider marks reauth only for invalid grant refresh failures', async () => {
  const characters = new FakeTokenCharacters({
    access_token: 'stale-token',
    access_token_expires_at: 1_100,
  });
  const getAccessToken = createAccessTokenProvider({
    characters,
    now: () => 1_000,
    refreshAccessToken: async () => {
      throw new Error('Refresh failed: 400 {"error":"invalid_grant"}');
    },
  });

  await assert.rejects(() => getAccessToken(101), /invalid_grant/);
  assert.deepEqual(characters.reauthMarked, [101]);
});

test('default AccessTokenProvider uses the configured async character store', async () => {
  const characters = new FakeTokenCharacters({
    access_token: 'configured-token',
    access_token_expires_at: 200_000,
  });
  const restore = setAccessTokenCharacterStore(characters);
  try {
    const getAccessToken = createAccessTokenProvider({
      now: () => 1_000,
      refreshAccessToken: async () => {
        throw new Error('should not refresh');
      },
    });

    assert.equal(await getAccessToken(101), 'configured-token');
  } finally {
    restore();
  }
});

class FakeTokenCharacters {
  row: CharacterRow;
  updated: Array<{ characterId: number; refreshToken: string; accessToken: string; accessTokenExpiresAt: number }> = [];
  reauthMarked: number[] = [];

  constructor(overrides: Partial<CharacterRow> = {}) {
    this.row = {
      character_id: 101,
      user_id: 'user-a',
      character_name: 'Alpha',
      owner_hash: 'owner-a',
      scopes: 'scope',
      refresh_token: 'refresh-old',
      access_token: null,
      access_token_expires_at: null,
      added_at: 1,
      needs_reauth: 0,
      is_boss: 0,
      ...overrides,
    };
  }

  async getById(characterId: number): Promise<CharacterRow | undefined> {
    return characterId === this.row.character_id ? this.row : undefined;
  }

  async updateTokens(
    characterId: number,
    input: { refreshToken: string; accessToken: string; accessTokenExpiresAt: number },
  ): Promise<CharacterRow | undefined> {
    this.updated.push({ characterId, ...input });
    this.row.refresh_token = input.refreshToken;
    this.row.access_token = input.accessToken;
    this.row.access_token_expires_at = input.accessTokenExpiresAt;
    this.row.needs_reauth = 0;
    return this.row;
  }

  async markNeedsReauth(characterId: number): Promise<boolean> {
    this.reauthMarked.push(characterId);
    this.row.needs_reauth = 1;
    return true;
  }
}
