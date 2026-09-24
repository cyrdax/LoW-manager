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

test('TrackedLog delays encoding selection for an empty new file until a split UTF-16LE BOM is complete', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'split-bom.log');
    await writeFile(file, Buffer.alloc(0));
    const tracked = await TrackedLog.open(file, 'new');

    await appendFile(file, Buffer.from([0xff]));
    assert.deepEqual(await tracked.readAppended(), { lines: [], truncated: false });
    await appendFile(file, Buffer.concat([
      Buffer.from([0xfe]),
      Buffer.from(`${listener}${decloak}`, 'utf16le'),
    ]));

    assert.deepEqual((await tracked.readAppended()).lines, [
      { text: '  Listener: Cyrdax Prime', byteOffset: 0 },
      { text: decloakText, byteOffset: 54 },
    ]);
    assert.equal(tracked.encoding, 'utf16le');
    assert.equal(tracked.characterName, 'Cyrdax Prime');
  });
});

test('TrackedLog preserves UTF-16LE EOF boundary context at every existing-file startup byte to decode the next event', async () => {
  await inTemporaryDirectory(async (directory) => {
    const historical = Buffer.from(`\uFEFF${listener}${decloak}`, 'utf16le');
    const nextText = '[ 2026.09.23 03:04:06 ] (notify) Your cloaking device has been forcibly deactivated.';
    const next = Buffer.from(`${nextText}\r\n`, 'utf16le');

    for (let split = 1; split < historical.length; split += 1) {
      const file = join(directory, `utf16-boundary-${split}.log`);
      await writeFile(file, historical.subarray(0, split));
      const tracked = await TrackedLog.open(file, 'existing');

      await appendFile(file, Buffer.concat([historical.subarray(split), next]));
      const { lines } = await tracked.readAppended();
      assert.deepEqual(lines.at(-1), {
        text: nextText,
        byteOffset: historical.length,
      });
    }
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

test('TrackedLog redetects replacement encoding and listener metadata instead of retaining the old file generation', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'encoding-replaced.log');
    const replacement = join(directory, 'encoding-replacement.log');
    const nextListener = '  Listener: Nova Pilot\r\n';
    await writeFile(file, `\uFEFF${listener}`, 'utf8');
    const tracked = await TrackedLog.open(file, 'existing');

    await writeFile(replacement, Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`${nextListener}${decloak}`, 'utf16le'),
    ]));
    await rename(replacement, file);

    const replacementRead = await tracked.readAppended();
    assert.equal(replacementRead.truncated, true);
    assert.deepEqual(replacementRead.lines.map((line) => line.text), [
      '  Listener: Nova Pilot',
      decloakText,
    ]);
    assert.equal(tracked.encoding, 'utf16le');
    assert.equal(tracked.characterName, 'Nova Pilot');
  });
});

test('TrackedLog clears character metadata when a replacement generation has no listener header', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'listenerless-replaced.log');
    const replacement = join(directory, 'listenerless-replacement.log');
    await writeFile(file, `\uFEFF${listener}`, 'utf8');
    const tracked = await TrackedLog.open(file, 'existing');

    await writeFile(replacement, 'replacement without listener\r\n', 'utf8');
    await rename(replacement, file);
    assert.deepEqual(await tracked.readAppended(), {
      lines: [{ text: 'replacement without listener', byteOffset: 0 }],
      truncated: true,
    });
    assert.equal(tracked.characterName, null);
  });
});

test('TrackedLog rejects a UTF-16BE replacement rather than retaining the previous decoder', async () => {
  await inTemporaryDirectory(async (directory) => {
    const file = join(directory, 'be-replaced.log');
    const replacement = join(directory, 'be-replacement.log');
    await writeFile(file, `\uFEFF${listener}`, 'utf8');
    const tracked = await TrackedLog.open(file, 'existing');

    await writeFile(replacement, Buffer.from([0xfe, 0xff, 0x00, 0x4c, 0x00, 0x0a]));
    await rename(replacement, file);
    await assert.rejects(tracked.readAppended(), UnsupportedLogEncodingError);
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
