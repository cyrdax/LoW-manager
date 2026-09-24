import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rename, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LogFileGoneError, TrackedLog, UnsupportedLogEncodingError } from './tracked-log.js';

const listener = '  Listener: Cyrdax Prime\r\n';
const decloakText = '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.';
const decloak = `${decloakText}\r\n`;

async function inTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'cloak-watch-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('TrackedLog skips existing UTF-8 and UTF-16LE history while retaining listener metadata and exact append offsets', async () => {
  await inTemporaryDirectory(async (directory) => {
    for (const [encoding, firstAppendOffset] of [
      ['utf8', 29],
      ['utf16le', 54],
    ] as const) {
      const file = join(directory, `${encoding}-existing.log`);
      await writeFile(file, Buffer.from(`\uFEFF${listener}`, encoding));

      const existing = await TrackedLog.open(file, 'existing');
      assert.equal(existing.characterName, 'Cyrdax Prime');
      assert.deepEqual(await existing.readAppended(), { lines: [], truncated: false });

      await appendFile(file, Buffer.from(decloak, encoding));
      assert.deepEqual(await existing.readAppended(), {
        lines: [{ text: decloakText, byteOffset: firstAppendOffset }],
        truncated: false,
      });
    }
  });
});

test('TrackedLog reads a new file from byte zero so listener headers are available for immediate monitoring', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'new.log');
    await writeFile(file, Buffer.from(`\uFEFF${listener}${decloak}`, 'utf8'));

    const fresh = await TrackedLog.open(file, 'new');
    assert.deepEqual(await fresh.readAppended(), {
      lines: [
        { text: '  Listener: Cyrdax Prime', byteOffset: 0 },
        { text: decloakText, byteOffset: 29 },
      ],
      truncated: false,
    });
    assert.equal(fresh.characterName, 'Cyrdax Prime');
  });
});

test('TrackedLog retains an incomplete final line until the next append and never replays completed lines', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'partial.log');
    await writeFile(file, 'first half', 'utf8');
    const tracked = await TrackedLog.open(file, 'new');

    assert.deepEqual(await tracked.readAppended(), { lines: [], truncated: false });
    await appendFile(file, ' completed\r\n');
    assert.deepEqual(await tracked.readAppended(), {
      lines: [{ text: 'first half completed', byteOffset: 0 }],
      truncated: false,
    });
    assert.deepEqual(await tracked.readAppended(), { lines: [], truncated: false });
  });
});

test('TrackedLog resets its cursor after truncation and emits only replacement content', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'truncated.log');
    await writeFile(file, `${listener}this old line must not replay\r\n`, 'utf8');
    const tracked = await TrackedLog.open(file, 'existing');

    await truncate(file, 0);
    await appendFile(file, 'replacement\r\n');
    assert.deepEqual(await tracked.readAppended(), {
      lines: [{ text: 'replacement', byteOffset: 0 }],
      truncated: true,
    });
  });
});

test('TrackedLog recognizes a same-sized replacement file and reads its new content from byte zero', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'replaced.log');
    const replacement = join(directory, 'replacement.log');
    await writeFile(file, 'old entry\r\n', 'utf8');
    const tracked = await TrackedLog.open(file, 'existing');

    await writeFile(replacement, 'new entry\r\n', 'utf8');
    await rename(replacement, file);
    assert.deepEqual(await tracked.readAppended(), {
      lines: [{ text: 'new entry', byteOffset: 0 }],
      truncated: true,
    });
  });
});

test('TrackedLog reports a removed file as a typed empty read so a monitor can retire it safely', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'deleted.log');
    await writeFile(file, listener, 'utf8');
    const tracked = await TrackedLog.open(file, 'existing');
    await unlink(file);

    await assert.rejects(tracked.readAppended(), (error: unknown) => {
      assert.ok(error instanceof LogFileGoneError);
      assert.deepEqual(error.read, { lines: [], truncated: false });
      return true;
    });
  });
});

test('TrackedLog rejects UTF-16BE logs rather than silently decoding corrupted event text', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'utf16be.log');
    await writeFile(file, Buffer.from([0xfe, 0xff, 0x00, 0x4c, 0x00, 0x0a]));

    await assert.rejects(TrackedLog.open(file, 'new'), UnsupportedLogEncodingError);
  });
});
