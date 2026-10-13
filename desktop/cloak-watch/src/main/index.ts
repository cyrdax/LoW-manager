import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import { AlertService } from '../app/alert-service.js';
import { CloakWatchController } from '../app/controller.js';
import type { AppViewModel } from '../app/view-model.js';
import { validateLogDirectory } from '../core/log-directory.js';
import { LogMonitor } from '../core/log-monitor.js';
import { SettingsStore } from '../core/settings.js';
import { createNativeAdapters } from './native-adapters.js';
import { buildTrayTemplate } from './tray-template.js';
import { createSettingsWindowDefinition } from './window-options.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const uiDirectory = join(currentDirectory, '..', 'ui');
const iconPath = join(currentDirectory, '..', 'icon.png');

let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let controller: CloakWatchController | null = null;
let latestViewModel: AppViewModel | null = null;
let quitting = false;
let disposed = false;
let pingSequence = 0;
const pendingPings = new Map<string, {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showSettings();
    else void app.whenReady().then(showSettings);
  });

  void app.whenReady().then(startApplication);
}

async function startApplication(): Promise<void> {
  app.setAppUserModelId('com.outfit420.cloakwatch');
  await createSettingsWindow();

  const nativeAdapters = createNativeAdapters({
    sendToRenderer: requestRendererPing,
    notificationsSupported: () => Notification.isSupported(),
    showNotification: showNativeNotification,
    setLoginItem: (enabled) => {
      app.setLoginItemSettings({ openAtLogin: enabled });
    },
    chooseLogDirectory: async () => {
      const options: OpenDialogOptions = {
        title: 'Choose EVE GameLogs folder',
        properties: ['openDirectory'],
      };
      const result = settingsWindow
        ? await dialog.showOpenDialog(settingsWindow, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    openPath: (path) => shell.openPath(path),
    showSettings,
    quit: () => {
      quitting = true;
      app.quit();
    },
  });

  const alertService = new AlertService(nativeAdapters);
  controller = new CloakWatchController({
    settingsStore: new SettingsStore(app.getPath('userData')),
    documentsDirectory: app.getPath('documents'),
    validateDirectory: validateLogDirectory,
    createMonitor: (options) => new LogMonitor(options),
    alertService,
    setLoginItem: nativeAdapters.setStartAtLogin,
    onViewModel: updateViewModel,
    requestShowSettings: showSettings,
    now: () => new Date(),
  });

  registerIpc(nativeAdapters.chooseLogDirectory);
  createTray(nativeAdapters.openLogDirectory);
  await controller.start();
}

async function createSettingsWindow(): Promise<void> {
  const definition = createSettingsWindowDefinition(
    join(uiDirectory, 'preload.cjs'),
    join(uiDirectory, 'index.html'),
  );
  settingsWindow = new BrowserWindow({
    ...definition.options,
    title: 'Outfit420 Cloak Watch',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: iconPath,
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', (event) => { event.preventDefault(); });
  settingsWindow.webContents.on('did-finish-load', () => {
    if (latestViewModel) settingsWindow?.webContents.send('cloak-watch:state', latestViewModel);
  });
  settingsWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    settingsWindow?.hide();
  });
  await settingsWindow.loadFile(definition.htmlPath);
}

function createTray(openLogDirectory: (path: string) => Promise<void>): void {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('Outfit420 Cloak Watch');
  tray.on('click', showSettings);
  rebuildTray(openLogDirectory);
}

function rebuildTray(openLogDirectory?: (path: string) => Promise<void>): void {
  if (!tray || !controller || !latestViewModel) return;
  const model = latestViewModel;
  const template = buildTrayTemplate(model, {
    setSoundEnabled: (enabled) => controller!.setSoundEnabled(enabled),
    setNotificationsEnabled: (enabled) => controller!.setNotificationsEnabled(enabled),
    setStartAtLogin: (enabled) => controller!.setStartAtLogin(enabled),
    testAlert: async () => { await controller!.testAlert(); },
    openSettings: showSettings,
    openLogDirectory: async () => {
      if (model.logDirectory && openLogDirectory) await openLogDirectory(model.logDirectory);
    },
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function updateViewModel(viewModel: AppViewModel): void {
  latestViewModel = viewModel;
  rebuildTray(async (path) => {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('cloak-watch:state', viewModel);
  }
}

function registerIpc(chooseLogDirectory: () => Promise<string | null>): void {
  ipcMain.handle('cloak-watch:get-state', (event) => {
    assertTrustedSender(event);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:choose-log-directory', async (event) => {
    assertTrustedSender(event);
    const directory = await chooseLogDirectory();
    if (directory) await controller?.setLogDirectory(directory);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:set-sound', async (event, enabled: boolean) => {
    assertTrustedSender(event);
    await controller?.setSoundEnabled(enabled);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:set-notifications', async (event, enabled: boolean) => {
    assertTrustedSender(event);
    await controller?.setNotificationsEnabled(enabled);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:set-start-at-login', async (event, enabled: boolean) => {
    assertTrustedSender(event);
    await controller?.setStartAtLogin(enabled);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:test-alert', async (event) => {
    assertTrustedSender(event);
    await controller?.testAlert();
    return controller?.getViewModel();
  });
  ipcMain.on('cloak-watch:play-ping-result', (event, requestId: unknown, error: unknown) => {
    assertTrustedSender(event);
    if (typeof requestId !== 'string') return;
    const pending = pendingPings.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingPings.delete(requestId);
    if (typeof error === 'string' && error) pending.reject(new Error(error));
    else pending.resolve();
  });
}

function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  if (!settingsWindow || settingsWindow.isDestroyed() || event.sender.id !== settingsWindow.webContents.id) {
    throw new Error('Rejected IPC from an untrusted renderer');
  }
}

function requestRendererPing(channel: 'cloak-watch:play-ping'): Promise<void> {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return Promise.reject(new Error('Settings window is unavailable'));
  }
  const requestId = `ping-${++pingSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPings.delete(requestId);
      reject(new Error('Sound alert delivery timed out'));
    }, 5_000);
    pendingPings.set(requestId, { resolve, reject, timeout });
    try {
      settingsWindow!.webContents.send(channel, requestId);
    } catch (error) {
      clearTimeout(timeout);
      pendingPings.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function showNativeNotification(title: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const notification = new Notification({ title, body, icon: iconPath });
    const timeout = setTimeout(() => reject(new Error('Desktop notification delivery timed out')), 5_000);
    notification.once('show', () => {
      clearTimeout(timeout);
      resolve();
    });
    notification.once('failed', (_event, error) => {
      clearTimeout(timeout);
      reject(new Error(error || 'Desktop notification could not be shown'));
    });
    notification.show();
  });
}

function showSettings(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.show();
  settingsWindow.focus();
}

app.on('activate', showSettings);
app.on('window-all-closed', () => { /* Tray application stays active. */ });
app.on('before-quit', (event) => {
  if (disposed || !controller) return;
  event.preventDefault();
  quitting = true;
  const currentController = controller;
  controller = null;
  void currentController.dispose().finally(() => {
    disposed = true;
    app.quit();
  });
});
