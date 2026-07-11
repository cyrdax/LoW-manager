import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  v: 1;
  alg: 'A256GCM';
  iv: string;
  tag: string;
  ciphertext: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;

export function tokenEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('Missing env TOKEN_ENCRYPTION_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer = tokenEncryptionKey()): EncryptedSecret {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSecret(envelope: EncryptedSecret, key: Buffer = tokenEncryptionKey()): string {
  assertKey(key);
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') throw new Error('Unsupported encrypted secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error('Encryption key must be 32 bytes');
}
