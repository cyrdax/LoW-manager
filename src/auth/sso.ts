import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { db } from '../db.ts';
import { SCOPE_STRING } from './scopes.ts';
import { characterIdFromSub, verifyEveJwt } from './jwt.ts';

const AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize';
const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${env('EVE_CLIENT_ID')}:${env('EVE_CLIENT_SECRET')}`).toString('base64');
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: 'Bearer';
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    },
    body,
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TokenResponse>;
}

export function registerSsoRoutes(app: FastifyInstance) {
  app.get('/auth/login', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)').run(state, Date.now());
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: env('EVE_CALLBACK_URL'),
      client_id: env('EVE_CLIENT_ID'),
      scope: SCOPE_STRING,
      state,
    });
    return reply.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/callback', async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state) return reply.code(400).send('Missing code/state');

    const stateRow = db.prepare('SELECT state FROM oauth_states WHERE state = ?').get(state);
    if (!stateRow) return reply.code(400).send('Invalid state');
    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

    const tokens = await exchangeCode(code);
    const claims = await verifyEveJwt(tokens.access_token);
    const characterId = characterIdFromSub(claims.sub);
    const scopes = Array.isArray(claims.scp) ? claims.scp.join(' ') : claims.scp;
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    db.prepare(`
      INSERT INTO characters (character_id, character_name, owner_hash, scopes,
        refresh_token, access_token, access_token_expires_at, added_at, needs_reauth, is_boss)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT(character_id) DO UPDATE SET
        character_name = excluded.character_name,
        owner_hash = excluded.owner_hash,
        scopes = excluded.scopes,
        refresh_token = excluded.refresh_token,
        access_token = excluded.access_token,
        access_token_expires_at = excluded.access_token_expires_at,
        needs_reauth = 0
    `).run(
      characterId,
      claims.name,
      claims.owner,
      scopes,
      tokens.refresh_token,
      tokens.access_token,
      expiresAt,
      Date.now(),
    );

    return reply.type('text/html').send(`
      <!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
        <h2>Authenticated: ${escapeHtml(claims.name)}</h2>
        <p>You can close this tab.</p>
        <script>setTimeout(() => window.close(), 800);</script>
      </body></html>
    `);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
