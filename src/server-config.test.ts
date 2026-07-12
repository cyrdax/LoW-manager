import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  cookieSecretFromEnv,
  isSensitiveFallbackPath,
  secureCookiesFromEnv,
  serverListenOptionsFromEnv,
} from './server-config.ts';

test('server listen options are local by default and public in production', () => {
  assert.deepEqual(serverListenOptionsFromEnv({}), { port: 3100, host: '127.0.0.1' });
  assert.deepEqual(serverListenOptionsFromEnv({ PORT: '8080', NODE_ENV: 'production' }), {
    port: 8080,
    host: '0.0.0.0',
  });
  assert.deepEqual(serverListenOptionsFromEnv({ PORT: '9000', HOST: '::' }), {
    port: 9000,
    host: '::',
  });
});

test('production security config enables secure cookies and requires a real cookie secret', () => {
  assert.equal(secureCookiesFromEnv({ APP_BASE_URL: 'https://low.example.com' }), true);
  assert.equal(secureCookiesFromEnv({ NODE_ENV: 'production', APP_BASE_URL: 'http://localhost:3100' }), true);
  assert.equal(secureCookiesFromEnv({ APP_BASE_URL: 'http://localhost:5173' }), false);

  assert.equal(cookieSecretFromEnv({}), 'dev-secret');
  assert.throws(
    () => cookieSecretFromEnv({ NODE_ENV: 'production' }),
    /COOKIE_SECRET/,
  );
  assert.throws(
    () => cookieSecretFromEnv({ NODE_ENV: 'production', COOKIE_SECRET: 'change-me-to-a-long-random-string' }),
    /COOKIE_SECRET/,
  );
  assert.equal(
    cookieSecretFromEnv({ NODE_ENV: 'production', COOKIE_SECRET: 'a-real-random-cookie-secret' }),
    'a-real-random-cookie-secret',
  );
});

test('package start runs the server entrypoint that production build verifies', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(pkg.scripts?.start, 'node --import tsx src/server.ts');
});

test('static fallback blocks dotfiles and common scanner paths', () => {
  assert.equal(isSensitiveFallbackPath('/.env'), true);
  assert.equal(isSensitiveFallbackPath('/.git/config'), true);
  assert.equal(isSensitiveFallbackPath('/config/.env.production'), true);
  assert.equal(isSensitiveFallbackPath('/wp-admin/setup-config.php'), true);
  assert.equal(isSensitiveFallbackPath('/api/auth/me'), false);
  assert.equal(isSensitiveFallbackPath('/auth/password/reset?token=abc'), false);
  assert.equal(isSensitiveFallbackPath('/fits'), false);
});
