import { Algorithm, hash, verify, type Options } from '@node-rs/argon2';

const DEFAULT_OPTIONS: Options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string, options: Options = DEFAULT_OPTIONS): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, password);
}
