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
    sendToRenderer: (channel) => {
      if (!settingsWindow || settingsWindow.isDestroyed()) throw new Error('Settings window is unavailable');
      settingsWindow.webContents.send(channel);
    },
    notificationsSupported: () => Notification.isSupported(),
    showNotification: (title, body) => {
      new Notification({ title, body, icon: iconPath }).show();
    },
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
  ipcMain.handle('cloak-watch:get-state', () => controller?.getViewModel());
  ipcMain.handle('cloak-watch:choose-log-directory', async () => {
    const directory = await chooseLogDirectory();
    if (directory) await controller?.setLogDirectory(directory);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:set-sound', async (_event, enabled: boolean) => {
    await controller?.setSoundEnabled(enabled);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:set-notifications', async (_event, enabled: boolean) => {
    await controller?.setNotificationsEnabled(enabled);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:set-start-at-login', async (_event, enabled: boolean) => {
    await controller?.setStartAtLogin(enabled);
    return controller?.getViewModel();
  });
  ipcMain.handle('cloak-watch:test-alert', async () => {
    await controller?.testAlert();
    return controller?.getViewModel();
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
