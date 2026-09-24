import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AppSettings {
  version: 1;
  logDirectory: string | null;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  startAtLogin: boolean;
}

export interface SettingsLoadResult {
  settings: AppSettings;
  warning: string | null;
}

export interface SettingsFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export const DEFAULT_SETTINGS = Object.freeze<AppSettings>({
  version: 1,
  logDirectory: null,
  soundEnabled: true,
  notificationsEnabled: true,
  startAtLogin: true,
});

const nodeFileSystem: SettingsFileSystem = {
  mkdir,
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function isAppSettings(value: unknown): value is AppSettings {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const settings = value as Record<string, unknown>;
  return settings.version === 1
    && (typeof settings.logDirectory === 'string' || settings.logDirectory === null)
    && typeof settings.soundEnabled === 'boolean'
    && typeof settings.notificationsEnabled === 'boolean'
    && typeof settings.startAtLogin === 'boolean';
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function createDefaultSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS };
}

export class SettingsStore {
  readonly #settingsPath: string;
  readonly #temporaryPath: string;
  readonly #corruptPath: string;

  constructor(
    private readonly userDataDirectory: string,
    private readonly fileSystem: SettingsFileSystem = nodeFileSystem,
  ) {
    this.#settingsPath = join(userDataDirectory, 'settings.json');
    this.#temporaryPath = join(userDataDirectory, 'settings.json.tmp');
    this.#corruptPath = join(userDataDirectory, 'settings.json.corrupt');
  }

  async load(): Promise<SettingsLoadResult> {
    let serialized: string;
    try {
      serialized = await this.fileSystem.readFile(this.#settingsPath);
    } catch (error) {
      if (isNotFound(error)) {
        return { settings: createDefaultSettings(), warning: null };
      }
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!isAppSettings(parsed)) {
        throw new Error('Unsupported settings version or invalid settings fields');
      }
      return { settings: parsed, warning: null };
    } catch (error) {
      await this.fileSystem.rename(this.#settingsPath, this.#corruptPath);
      await this.save(createDefaultSettings());
      const description = error instanceof Error ? error.message : 'Invalid settings data';
      return {
        settings: createDefaultSettings(),
        warning: `Settings were reset after recovery: ${description}`,
      };
    }
  }

  async save(settings: AppSettings): Promise<void> {
    if (!isAppSettings(settings)) {
      throw new TypeError('Cannot save invalid settings');
    }

    await this.fileSystem.mkdir(this.userDataDirectory, { recursive: true });
    await this.fileSystem.writeFile(this.#temporaryPath, JSON.stringify(settings, null, 2));
    await this.fileSystem.rename(this.#temporaryPath, this.#settingsPath);
  }
}
