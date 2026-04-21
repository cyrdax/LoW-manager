import { db } from '../db.ts';
import type { CharacterRow } from '../types.ts';
import { refreshAccessToken } from './sso.ts';

const REFRESH_BUFFER_MS = 2 * 60 * 1000;

export async function getAccessToken(characterId: number): Promise<string> {
  const row = db.prepare('SELECT * FROM characters WHERE character_id = ?').get(characterId) as CharacterRow | undefined;
  if (!row) throw new Error(`Unknown character ${characterId}`);
  if (row.needs_reauth) throw new Error(`Character ${characterId} needs reauth`);

  if (row.access_token && row.access_token_expires_at && row.access_token_expires_at - Date.now() > REFRESH_BUFFER_MS) {
    return row.access_token;
  }

  try {
    const tok = await refreshAccessToken(row.refresh_token);
    const expiresAt = Date.now() + tok.expires_in * 1000;
    db.prepare(`
      UPDATE characters SET access_token = ?, access_token_expires_at = ?, refresh_token = ?, needs_reauth = 0
      WHERE character_id = ?
    `).run(tok.access_token, expiresAt, tok.refresh_token, characterId);
    return tok.access_token;
  } catch (err) {
    db.prepare('UPDATE characters SET needs_reauth = 1 WHERE character_id = ?').run(characterId);
    throw err;
  }
}
