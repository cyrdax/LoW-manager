import { lstat, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { watch, type ChokidarOptions } from 'chokidar';

import { validateLogDirectory, type DirectoryValidation } from './log-directory.js';
import { parseLogEntry, toDecloakEvent } from './parser.js';
import { LogFileGoneError, TrackedLog, UnsupportedLogEncodingError } from './tracked-log.js';
import type { DecloakEvent } from './types.js';

export type MonitorStatus =
  | { kind: 'watching'; activeLogs: number }
  | { kind: 'waiting'; activeLogs: 0 }
  | { kind: 'error'; activeLogs: number; message: string };

export interface LogMonitorOptions {
  directory: string;
  onDecloak(event: DecloakEvent): void;
  onStatus(status: MonitorStatus): void;
  reconcileIntervalMs?: number;
}

export interface LogWatcher {
  on(event: 'add' | 'change' | 'unlink', callback: (path: string) => void): this;
  on(event: 'error', callback: (error: Error) => void): this;
  on(event: 'ready', callback: () => void): this;
  close(): Promise<void>;
}

export interface MonitorDependencies {
  watch(directory: string, options: ChokidarOptions): LogWatcher;
  validateDirectory(directory: string): Promise<DirectoryValidation>;
  listFiles(directory: string): Promise<string[]>;
  isRegularFile(path: string): Promise<boolean>;
  openLog(path: string, mode: 'existing' | 'new'): Promise<Pick<TrackedLog, 'characterName' | 'readAppended'>>;
  scheduler: {
    every(ms: number, callback: () => void): () => void;
    after(ms: number, callback: () => void): () => void;
  };
}

const defaults: MonitorDependencies = {
  watch,
  validateDirectory: validateLogDirectory,
  listFiles: async (directory) => (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(directory, entry.name)),
  openLog: (path, mode) => TrackedLog.open(path, mode),
  isRegularFile: async (path) => (await lstat(path)).isFile(),
  scheduler: {
    every: (ms, callback) => {
      const timer = setInterval(callback, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
    after: (ms, callback) => {
      const timer = setTimeout(callback, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
  },
};

const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

export class LogMonitor {
  private readonly directory: string;
  private readonly dependencies: MonitorDependencies;
  private readonly logs = new Map<string, Pick<TrackedLog, 'characterName' | 'readAppended'>>();
  private readonly knownPaths = new Set<string>();
  private readonly fileErrors = new Map<string, string>();
  // One queue also serializes retirement and reopen against reads of the same path.
  private queue: Promise<void> = Promise.resolve();
  private running = false;
  private epoch = 0;
  private operationEpoch = 0;
  private watcher: LogWatcher | null = null;
  private cancelInterval: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;
  private failures = 0;
  private inaccessible = false;
  private directoryError: string | null = null;
  private watcherError: string | null = null;
  private callbackError: string | null = null;

  constructor(private readonly options: LogMonitorOptions, dependencies: Partial<MonitorDependencies> = {}) {
    this.directory = resolve(options.directory);
    this.dependencies = { ...defaults, ...dependencies };
  }

  start(): Promise<void> {
    if (this.running) return this.queue;
    this.running = true;
    this.epoch++;
    return this.enqueue(async () => {
      await this.scan();
      if (!this.isCurrent()) return;
      const interval = this.options.reconcileIntervalMs ?? 2000;
      if (interval > 0) {
        this.cancelInterval = this.dependencies.scheduler.every(interval, () => { void this.reconcile(); });
      }
    });
  }

  reconcile(): Promise<void> {
    return this.enqueue(() => this.scan());
  }

  stop(): Promise<void> {
    this.running = false;
    this.epoch++;
    this.cancelInterval?.();
    this.cancelInterval = null;
    this.cancelRetry?.();
    this.cancelRetry = null;
    // In-flight I/O drains before retirement, but running=false suppresses its callbacks immediately.
    this.queue = this.queue.then(async () => {
      await this.closeWatcher();
      this.logs.clear();
      this.knownPaths.clear();
      this.fileErrors.clear();
      this.directoryError = this.watcherError = this.callbackError = null;
      this.failures = 0;
      this.inaccessible = false;
    });
    return this.queue;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const epoch = this.epoch;
    this.queue = this.queue.then(async () => {
      if (!this.running || epoch !== this.epoch) return;
      this.operationEpoch = epoch;
      try {
        await operation();
      } catch (error) {
        this.directoryError = `Unable to monitor ${this.directory}. Check directory access: ${describe(error)}`;
      }
      if (this.running && epoch === this.epoch) this.emitStatus();
    });
    return this.queue;
  }

  private async scan(): Promise<void> {
    const validation = await this.dependencies.validateDirectory(this.directory);
    if (!this.isCurrent()) return;
    if (!validation.ok) {
      const advice = validation.reason === 'not-found'
        ? 'Directory not found. Select an existing EVE Gamelogs directory.'
        : validation.reason === 'not-directory'
          ? 'Selected path is not a directory. Select the EVE Gamelogs directory.'
          : 'Directory is not readable. Check its access permissions.';
      await this.loseAccess(advice);
      return;
    }

    let paths: Set<string>;
    try {
      paths = new Set((await this.dependencies.listFiles(this.directory))
        .map((path) => resolve(path)).filter((path) => this.isLogPath(path)));
    } catch (error) {
      await this.loseAccess(`Unable to list directory. Check its access permissions: ${describe(error)}`);
      return;
    }
    if (!this.isCurrent()) return;
    this.directoryError = null;
    if (this.inaccessible) {
      this.inaccessible = false;
      this.failures = 0;
      this.watcherError = null;
    }
    for (const path of this.knownPaths) {
      if (!paths.has(path)) this.retire(path);
    }
    for (const path of paths) {
      if (!this.isCurrent()) return;
      await this.read(path, 'existing');
    }
    if (this.isCurrent() && this.watcher === null && this.failures === 0) await this.connectWatcher();
  }

  private async read(path: string, mode: 'existing' | 'new'): Promise<void> {
    const known = this.knownPaths.has(path);
    this.knownPaths.add(path);
    try {
      if (!await this.dependencies.isRegularFile(path)) {
        this.retire(path);
        return;
      }
      if (!this.isCurrent()) return;
      let log = this.logs.get(path);
      if (!log) {
        log = await this.dependencies.openLog(path, known ? 'existing' : mode);
        if (!this.isCurrent()) return;
        this.logs.set(path, log);
      }
      const result = await log.readAppended();
      this.fileErrors.delete(path);
      for (const line of result.lines) {
        if (!this.isCurrent()) return;
        const event = toDecloakEvent(parseLogEntry(line.text), {
          characterName: log.characterName,
          sourceFile: path,
          byteOffset: line.byteOffset,
        });
        if (event) {
          try {
            this.options.onDecloak(event);
          } catch (error) {
            // The cursor has advanced; retrying a consumer callback could duplicate delivery.
            this.callbackError = `Decloak callback failed: ${describe(error)}`;
          }
        }
      }
    } catch (error) {
      if (error instanceof LogFileGoneError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.retire(path);
      } else {
        if (error instanceof UnsupportedLogEncodingError) this.logs.delete(path);
        this.fileErrors.set(path, `Unable to read ${path}. Check the file and read permissions: ${describe(error)}`);
      }
    }
  }

  private async connectWatcher(): Promise<void> {
    if (!this.isCurrent() || this.inaccessible) return;
    try {
      const watcher = this.dependencies.watch(this.directory, {
        // Snapshot paths already have EOF cursors. Keep initial adds so files born
        // between that snapshot and Chokidar's first scan still start at byte zero.
        ignoreInitial: false,
        depth: 0,
        followSymlinks: false,
        atomic: true,
      });
      this.watcher = watcher;
      const dispatch = (operation: () => Promise<void>) => {
        void this.enqueue(async () => {
          if (this.watcher === watcher) await operation();
        });
      };
      for (const event of ['add', 'change', 'unlink'] as const) {
        watcher.on(event, (file) => dispatch(async () => {
          const path = resolve(file);
          if (!this.isLogPath(path)) return;
          // Unlink may describe an older generation already replaced and read by
          // reconciliation. Revalidate through read: only a missing/non-file path
          // retires its cursor; an existing replacement retains its progress.
          await this.read(path, event === 'add' ? 'new' : 'existing');
        }));
      }
      watcher.on('error', (error) => dispatch(() => this.watchFailed(error)));
      watcher.on('ready', () => dispatch(async () => {
        this.failures = 0;
        this.watcherError = null;
      }));
    } catch (error) {
      await this.watchFailed(error);
    }
  }

  private async watchFailed(error: unknown): Promise<void> {
    await this.closeWatcher();
    if (!this.isCurrent()) return;
    this.watcherError = `File watcher failed. Check directory access; periodic reconciliation continues: ${describe(error)}`;
    const delay = RETRY_DELAYS[this.failures++];
    if (delay !== undefined) {
      this.cancelRetry = this.dependencies.scheduler.after(delay, () => {
        this.cancelRetry = null;
        void this.enqueue(async () => {
          await this.scan();
          if (!this.inaccessible && this.watcher === null) await this.connectWatcher();
        });
      });
    }
  }

  private async loseAccess(message: string): Promise<void> {
    this.directoryError = `${message} (${this.directory})`;
    this.inaccessible = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    await this.closeWatcher();
  }

  private async closeWatcher(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    try {
      await watcher?.close();
    } catch (error) {
      this.watcherError = `Unable to close file watcher: ${describe(error)}`;
    }
  }

  private retire(path: string): void {
    this.logs.delete(path);
    this.knownPaths.delete(path);
    this.fileErrors.delete(path);
  }

  private isLogPath(path: string): boolean {
    return dirname(path) === this.directory && ['.txt', '.log'].includes(extname(path).toLowerCase());
  }

  private isCurrent(): boolean {
    return this.running && this.operationEpoch === this.epoch;
  }

  private emitStatus(): void {
    const activeLogs = this.logs.size;
    const message = this.directoryError ?? this.watcherError ?? this.fileErrors.values().next().value ?? this.callbackError;
    const status: MonitorStatus = message
      ? { kind: 'error', activeLogs, message }
      : activeLogs > 0 ? { kind: 'watching', activeLogs } : { kind: 'waiting', activeLogs: 0 };
    try { this.options.onStatus(status); } catch { /* Consumer errors must not break monitoring. */ }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
