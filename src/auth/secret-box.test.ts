import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, tokenEncryptionKey, type EncryptedSecret } from './secret-box.ts';

const key = Buffer.alloc(32, 7);

test('encryptSecret and decryptSecret round-trip token values', () => {
  const encrypted = encryptSecret('refresh-token-value', key);

  assert.equal(encrypted.v, 1);
  assert.equal(encrypted.alg, 'A256GCM');
  assert.notEqual(encrypted.ciphertext, 'refresh-token-value');
  assert.equal(decryptSecret(encrypted, key), 'refresh-token-value');
});

test('encryptSecret uses a fresh iv for each encryption', () => {
  const a = encryptSecret('same-token', key);
  const b = encryptSecret('same-token', key);

  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('decryptSecret rejects tampered ciphertext', () => {
  const encrypted = encryptSecret('refresh-token-value', key);
  const tampered: EncryptedSecret = {
    ...encrypted,
    ciphertext: Buffer.from('tampered').toString('base64'),
  };

  assert.throws(() => decryptSecret(tampered, key));
});

test('tokenEncryptionKey requires a 32-byte base64 key', () => {
  assert.equal(tokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: key.toString('base64') }).length, 32);
  assert.throws(() => tokenEncryptionKey({}), /Missing env/);
  assert.throws(() => tokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }), /32 bytes/);
});
