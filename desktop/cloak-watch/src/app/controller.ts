import { defaultLogDirectory, type DirectoryValidation } from '../core/log-directory.js';
import type { LogMonitor, LogMonitorOptions, MonitorStatus } from '../core/log-monitor.js';
import { DEFAULT_SETTINGS, type AppSettings, type SettingsStore } from '../core/settings.js';
import type { DecloakEvent } from '../core/types.js';
import { AlertService, type AlertResult } from './alert-service.js';
import type { AppViewModel } from './view-model.js';

export interface ControllerDependencies {
  settingsStore: SettingsStore;
  documentsDirectory: string;
  validateDirectory(path: string): Promise<DirectoryValidation>;
  createMonitor(options: LogMonitorOptions): LogMonitor;
  alertService: AlertService;
  setLoginItem(enabled: boolean): Promise<void>;
  onViewModel(viewModel: AppViewModel): void;
  requestShowSettings(): void;
  now(): Date;
}

type ViewModelListener = (viewModel: AppViewModel) => void;

export class CloakWatchController {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private monitor: LogMonitor | null = null;
  private monitorGeneration = 0;
  private started = false;
  private disposed = false;
  private activeLogs = 0;
  private statusText = 'Waiting for EVE game logs';
  private latestEventText = '';
  private settingsWarning: string | null = null;
  private runtimeWarning: string | null = null;
  private monitorWarning: string | null = null;
  private soundWarning: string | null = null;
  private notificationWarning: string | null = null;
  private readonly listeners = new Set<ViewModelListener>();

  constructor(private readonly dependencies: ControllerDependencies) {}

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      const loaded = await this.dependencies.settingsStore.load();
      this.settings = { ...loaded.settings };
      this.settingsWarning = loaded.warning;
    } catch (error) {
      this.settings = { ...DEFAULT_SETTINGS };
      this.settingsWarning = `Unable to load settings: ${describe(error)}`;
    }
    this.emit();

    await this.configureLoginItem();
    const directory = this.settings.logDirectory ?? defaultLogDirectory(this.dependencies.documentsDirectory);
    const validation = await this.validate(directory);
    if (!validation.ok) {
      this.runtimeWarning = directoryWarning(validation);
      this.emit();
      this.requestSettings();
      return;
    }

    await this.startMonitor(directory);
  }

  async setLogDirectory(directory: string): Promise<void> {
    if (this.disposed) return;
    const validation = await this.validate(directory);
    if (!validation.ok) {
      const warning = directoryWarning(validation);
      this.runtimeWarning = warning;
      this.emit();
      throw new Error(warning);
    }

    if (!await this.persist({ ...this.settings, logDirectory: directory })) return;
    await this.stopMonitor();
    await this.startMonitor(directory);
  }

  async setSoundEnabled(enabled: boolean): Promise<void> {
    if (await this.persist({ ...this.settings, soundEnabled: enabled }) && !enabled && this.soundWarning) {
      this.soundWarning = null;
      this.emit();
    }
  }

  async setNotificationsEnabled(enabled: boolean): Promise<void> {
    if (await this.persist({ ...this.settings, notificationsEnabled: enabled }) && !enabled && this.notificationWarning) {
      this.notificationWarning = null;
      this.emit();
    }
  }

  async setStartAtLogin(enabled: boolean): Promise<void> {
    if (await this.persist({ ...this.settings, startAtLogin: enabled })) await this.configureLoginItem();
  }

  async testAlert(): Promise<AlertResult> {
    const result = await this.dependencies.alertService.test(this.settings);
    this.applyAlertErrors(result);
    return result;
  }

  getViewModel(): AppViewModel {
    return this.snapshot();
  }

  subscribe(listener: ViewModelListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    this.notify(listener, this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.monitorGeneration++;
    await this.stopMonitor();
    this.listeners.clear();
  }

  private async persist(next: AppSettings): Promise<boolean> {
    try {
      await this.dependencies.settingsStore.save(next);
      this.settings = next;
      this.settingsWarning = null;
      this.emit();
      return true;
    } catch (error) {
      this.settingsWarning = `Unable to save settings: ${describe(error)}`;
      this.emit();
      return false;
    }
  }

  private async configureLoginItem(): Promise<void> {
    try {
      await this.dependencies.setLoginItem(this.settings.startAtLogin);
    } catch (error) {
      this.runtimeWarning = `Unable to configure start at login: ${describe(error)}`;
      this.emit();
    }
  }

  private async validate(directory: string): Promise<DirectoryValidation> {
    try {
      return await this.dependencies.validateDirectory(directory);
    } catch (error) {
      this.runtimeWarning = `Unable to validate log folder: ${describe(error)}`;
      this.emit();
      return { ok: false, reason: 'not-readable' };
    }
  }

  private async startMonitor(directory: string): Promise<void> {
    const generation = ++this.monitorGeneration;
    this.activeLogs = 0;
    this.statusText = 'Waiting for EVE game logs';
    let monitor: LogMonitor;
    try {
      monitor = this.dependencies.createMonitor({
        directory,
        onDecloak: (event) => { void this.handleDecloak(generation, event); },
        onStatus: (status) => { this.handleStatus(generation, status); },
      });
      this.monitor = monitor;
      await monitor.start();
      if (generation === this.monitorGeneration && !this.disposed) this.emit();
    } catch (error) {
      if (generation === this.monitorGeneration && !this.disposed) {
        this.runtimeWarning = `Unable to start log monitor: ${describe(error)}`;
        this.emit();
      }
    }
  }

  private async stopMonitor(): Promise<void> {
    const monitor = this.monitor;
    this.monitor = null;
    if (!monitor) return;
    try {
      await monitor.stop();
    } catch (error) {
      this.runtimeWarning = `Unable to stop log monitor: ${describe(error)}`;
      this.emit();
    }
  }

  private async handleDecloak(generation: number, event: DecloakEvent): Promise<void> {
    if (generation !== this.monitorGeneration || this.disposed) return;
    this.latestEventText = `${event.characterName} — ${event.message}`;
    this.emit();
    try {
      const result = await this.dependencies.alertService.deliver(event, this.settings);
      if (generation === this.monitorGeneration && !this.disposed) this.applyAlertErrors(result);
    } catch (error) {
      if (generation === this.monitorGeneration && !this.disposed) {
        this.runtimeWarning = `Unable to deliver alert: ${describe(error)}`;
        this.emit();
      }
    }
  }

  private handleStatus(generation: number, status: MonitorStatus): void {
    if (generation !== this.monitorGeneration || this.disposed) return;
    this.activeLogs = status.activeLogs;
    if (status.kind === 'watching') {
      this.statusText = `Watching ${status.activeLogs} ${status.activeLogs === 1 ? 'log' : 'logs'}`;
      this.runtimeWarning = null;
      this.monitorWarning = null;
    } else if (status.kind === 'waiting') {
      this.statusText = 'Waiting for EVE game logs';
      this.runtimeWarning = null;
      this.monitorWarning = null;
    } else {
      this.statusText = `Monitoring error: ${status.message}`;
      this.monitorWarning = status.message;
    }
    this.emit();
  }

  private applyAlertErrors(result: AlertResult): void {
    this.soundWarning = result.soundError;
    this.notificationWarning = result.notificationError;
    this.emit();
  }

  private requestSettings(): void {
    try { this.dependencies.requestShowSettings(); } catch { /* UI failures must not stop monitoring setup. */ }
  }

  private snapshot(): AppViewModel {
    return Object.freeze({
      statusText: this.statusText,
      activeLogs: this.activeLogs,
      logDirectory: this.settings.logDirectory ?? defaultLogDirectory(this.dependencies.documentsDirectory),
      soundEnabled: this.settings.soundEnabled,
      notificationsEnabled: this.settings.notificationsEnabled,
      startAtLogin: this.settings.startAtLogin,
      latestEventText: this.latestEventText,
      warning: this.runtimeWarning
        ?? this.notificationWarning
        ?? this.soundWarning
        ?? this.monitorWarning
        ?? this.settingsWarning,
    });
  }

  private emit(): void {
    const viewModel = this.snapshot();
    this.notify(this.dependencies.onViewModel, viewModel);
    for (const listener of this.listeners) this.notify(listener, viewModel);
  }

  private notify(listener: ViewModelListener, viewModel: AppViewModel): void {
    try { listener(viewModel); } catch { /* UI observers are isolated from the coordinator. */ }
  }
}

function directoryWarning(validation: Exclude<DirectoryValidation, { ok: true }>): string {
  switch (validation.reason) {
    case 'not-found': return 'Log folder not found';
    case 'not-directory': return 'Log folder is not a directory';
    case 'not-readable': return 'Log folder is not readable';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
