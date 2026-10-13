import type { MenuItemConstructorOptions } from 'electron';
import type { AppViewModel } from '../app/view-model.js';

export interface TrayActions {
  setSoundEnabled(enabled: boolean): Promise<void>;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  testAlert(): Promise<void>;
  openSettings(): void;
  openLogDirectory(): Promise<void>;
  quit(): void;
}

export function buildTrayTemplate(
  viewModel: AppViewModel,
  actions: TrayActions,
): MenuItemConstructorOptions[] {
  const statusLabel = viewModel.activeLogs > 0
    ? `Watching ${viewModel.activeLogs} active ${viewModel.activeLogs === 1 ? 'log' : 'logs'}`
    : viewModel.statusText;

  return [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Sound',
      type: 'checkbox',
      checked: viewModel.soundEnabled,
      click: () => { void actions.setSoundEnabled(!viewModel.soundEnabled); },
    },
    {
      label: 'Notifications',
      type: 'checkbox',
      checked: viewModel.notificationsEnabled,
      click: () => { void actions.setNotificationsEnabled(!viewModel.notificationsEnabled); },
    },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: viewModel.startAtLogin,
      click: () => { void actions.setStartAtLogin(!viewModel.startAtLogin); },
    },
    { type: 'separator' },
    { label: 'Test alert', click: () => { void actions.testAlert(); } },
    { label: 'Open settings', click: () => { actions.openSettings(); } },
    {
      label: 'Open log folder',
      enabled: viewModel.logDirectory !== null,
      click: () => { void actions.openLogDirectory(); },
    },
    { type: 'separator' },
    {
      label: viewModel.latestEventText || 'No decloak detected this session',
      enabled: false,
    },
    ...(viewModel.warning ? [{ label: viewModel.warning, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => { actions.quit(); } },
  ];
}
