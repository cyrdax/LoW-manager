import assert from 'node:assert/strict';
import { Algorithm, type Options } from '@node-rs/argon2';
import test from 'node:test';
import { hashPassword, verifyPassword } from './password.ts';

const fastOptions: Options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 1024,
  timeCost: 1,
  parallelism: 1,
};

test('hashPassword stores an argon2id hash and verifyPassword checks it', async () => {
  const password = 'correct horse battery staple';
  const passwordHash = await hashPassword(password, fastOptions);

  assert.notEqual(passwordHash, password);
  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('wrong password', passwordHash), false);
});
