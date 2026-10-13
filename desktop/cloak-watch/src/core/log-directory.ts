import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type DirectoryValidation =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-directory' | 'not-readable' };

export interface DirectoryFileSystem {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  access(path: string, mode: number): Promise<void>;
}

const nodeFileSystem: DirectoryFileSystem = { stat, access };

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function defaultLogDirectory(documentsPath: string): string {
  return join(documentsPath, 'EVE', 'logs', 'Gamelogs');
}

export async function validateLogDirectory(
  path: string,
  fileSystem: DirectoryFileSystem = nodeFileSystem,
): Promise<DirectoryValidation> {
  let entry: { isDirectory(): boolean };
  try {
    entry = await fileSystem.stat(path);
  } catch (error) {
    return isNotFound(error)
      ? { ok: false, reason: 'not-found' }
      : { ok: false, reason: 'not-readable' };
  }

  if (!entry.isDirectory()) {
    return { ok: false, reason: 'not-directory' };
  }

  try {
    await fileSystem.access(path, constants.R_OK);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'not-readable' };
  }
}
