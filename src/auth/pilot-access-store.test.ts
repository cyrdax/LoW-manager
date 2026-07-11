import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFleetBossCharacter,
  getOwnedCharacter,
  listFleetInviteCharacters,
  ownsCharacter,
  setPilotAccessCharacterStore,
  userCharacterIds,
} from './pilot-access.ts';
import type { CharacterRow } from '../types.ts';

test('pilot access helpers use the configured async character store', async () => {
  const restore = setPilotAccessCharacterStore(new FakeCharacters());
  try {
    assert.equal(await ownsCharacter('user-a', 101), true);
    assert.equal(await ownsCharacter('user-b', 101), false);
    assert.equal((await getOwnedCharacter('user-a', 101))?.character_name, 'Alpha');
    assert.equal((await getFleetBossCharacter('user-a'))?.character_id, 101);
    assert.deepEqual((await listFleetInviteCharacters('user-a')).map(row => row.character_id), [102]);
    assert.deepEqual([...(await userCharacterIds('user-a'))], [101, 102]);
  } finally {
    restore();
  }
});

class FakeCharacters {
  rows: CharacterRow[] = [
    row({ character_id: 101, user_id: 'user-a', character_name: 'Alpha', is_boss: 1 }),
    row({ character_id: 102, user_id: 'user-a', character_name: 'Beta', is_boss: 0 }),
    row({ character_id: 202, user_id: 'user-b', character_name: 'Gamma', is_boss: 1 }),
  ];

  async listByUser(userId: string): Promise<CharacterRow[]> {
    return this.rows.filter(row => row.user_id === userId);
  }

  async listUsableByUser(userId: string): Promise<CharacterRow[]> {
    return this.rows.filter(row => row.user_id === userId && row.needs_reauth === 0);
  }

  async listIdsByUser(userId: string): Promise<number[]> {
    return this.rows.filter(row => row.user_id === userId).map(row => row.character_id);
  }

  async getOwned(userId: string, characterId: number): Promise<CharacterRow | undefined> {
    return this.rows.find(row => row.user_id === userId && row.character_id === characterId);
  }

  async owns(userId: string, characterId: number): Promise<boolean> {
    return !!await this.getOwned(userId, characterId);
  }
}

function row(overrides: Partial<CharacterRow>): CharacterRow {
  return {
    character_id: 0,
    user_id: '',
    character_name: '',
    owner_hash: 'owner',
    scopes: 'scope',
    refresh_token: 'refresh',
    access_token: null,
    access_token_expires_at: null,
    added_at: 1,
    needs_reauth: 0,
    is_boss: 0,
    ...overrides,
  };
}
