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
    // Only mark reauth on EVE's "token is dead" response (400 + invalid_grant).
    // Transient failures (5xx, network errors, rate limits) leave needs_reauth=0
    // so the next polling cycle can retry — otherwise a brief EVE hiccup forces
    // the user to re-login every character by hand.
    const msg = String((err as Error).message ?? '');
    if (/Refresh failed: 400\b/.test(msg) && /invalid_grant/.test(msg)) {
      db.prepare('UPDATE characters SET needs_reauth = 1 WHERE character_id = ?').run(characterId);
    }
    throw err;
  }
}
