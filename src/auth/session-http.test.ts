import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import {
  clearSessionCookie,
  safeLocalReturnTo,
  sessionMetadataForRequest,
  setSessionCookie,
} from './session-http.ts';

test('safeLocalReturnTo accepts local paths and rejects external or scheme-relative redirects', () => {
  assert.equal(safeLocalReturnTo('/fits?mode=fits'), '/fits?mode=fits');
  assert.equal(safeLocalReturnTo('/'), '/');
  assert.equal(safeLocalReturnTo('https://evil.example'), '/');
  assert.equal(safeLocalReturnTo('//evil.example'), '/');
  assert.equal(safeLocalReturnTo('javascript:alert(1)'), '/');
  assert.equal(safeLocalReturnTo('/auth/google/callback?code=secret'), '/');
  assert.equal(safeLocalReturnTo('  /fits/42?hub=Jita#items  '), '/fits/42?hub=Jita#items');
  assert.equal(safeLocalReturnTo(undefined), '/');
});

test('session HTTP helpers hash request metadata and issue the standard secure cookie', async () => {
  const app = Fastify();
  await app.register(cookie, { secret: 'test-cookie-secret' });
  app.get('/issue', async (req, reply) => {
    setSessionCookie(reply, 'raw-session-token', { cookieName: 'eve_session', secure: true });
    return sessionMetadataForRequest(req);
  });

  const response = await app.inject({
    method: 'GET',
    url: '/issue',
    headers: { 'user-agent': 'eve-test-agent' },
  });

  assert.deepEqual(response.json(), {
    ipHash: '12ca17b49af2289436f303e0166030a21e525d266e209267433801a8fd4071a0',
    userAgentHash: '731884b82363ccf13c69e00d59dd37de3572cab166b2e118b593fda055585306',
  });
  const rawSetCookie = response.headers['set-cookie'];
  if (typeof rawSetCookie !== 'string') throw new Error('missing session cookie');
  const setCookie = rawSetCookie;
  assert.match(setCookie, /^eve_session=/);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  const signedValue = /eve_session=([^;]+)/.exec(setCookie)?.[1];
  assert.ok(signedValue);
  assert.deepEqual(app.unsignCookie(decodeURIComponent(signedValue)), { valid: true, renew: false, value: 'raw-session-token' });

  await app.close();
});

test('clearSessionCookie expires the same cookie path and security attributes', async () => {
  const app = Fastify();
  await app.register(cookie, { secret: 'test-cookie-secret' });
  app.get('/clear', async (_req, reply) => {
    clearSessionCookie(reply, { cookieName: 'eve_session', secure: true });
    return { ok: true };
  });

  const response = await app.inject({ method: 'GET', url: '/clear' });
  const rawSetCookie = response.headers['set-cookie'];
  if (typeof rawSetCookie !== 'string') throw new Error('missing cleared session cookie');
  const setCookie = rawSetCookie;
  assert.match(setCookie, /^eve_session=;/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);

  await app.close();
});
