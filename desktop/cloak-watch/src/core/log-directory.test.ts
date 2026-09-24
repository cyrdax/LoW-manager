import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  defaultLogDirectory,
  type DirectoryFileSystem,
  validateLogDirectory,
} from './log-directory.js';

async function inTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'cloak-watch-log-directory-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('defaultLogDirectory derives the EVE Gamelogs path from the supplied documents directory', () => {
  assert.equal(
    defaultLogDirectory('/Users/test/Documents'),
    join('/Users/test/Documents', 'EVE', 'logs', 'Gamelogs'),
  );
});

test('validateLogDirectory accepts a real readable directory without creating any contents', async () => {
  await inTemporaryDirectory(async (directory) => {
    const readableDirectory = join(directory, 'Gamelogs');
    await mkdir(readableDirectory);

    assert.deepEqual(await validateLogDirectory(readableDirectory), { ok: true });
  });
});

test('validateLogDirectory identifies a missing directory and a file path', async () => {
  await inTemporaryDirectory(async (directory) => {
    const missingDirectory = join(directory, 'missing');
    const file = join(directory, 'not-a-directory.log');
    await writeFile(file, 'log data', 'utf8');

    assert.deepEqual(await validateLogDirectory(missingDirectory), {
      ok: false,
      reason: 'not-found',
    });
    assert.deepEqual(await validateLogDirectory(file), {
      ok: false,
      reason: 'not-directory',
    });
  });
});

test('validateLogDirectory reports a permission-denied directory as not-readable on every platform', async () => {
  await inTemporaryDirectory(async (directory) => {
    const readableDirectory = join(directory, 'Gamelogs');
    await mkdir(readableDirectory);
    const deniedFileSystem: DirectoryFileSystem = {
      stat,
      async access(path) {
        assert.equal(path, readableDirectory);
        const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
        throw error;
      },
    };

    assert.deepEqual(await validateLogDirectory(readableDirectory, deniedFileSystem), {
      ok: false,
      reason: 'not-readable',
    });
    await access(readableDirectory);
  });
});
