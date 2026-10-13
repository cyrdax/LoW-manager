import type { BrowserWindowConstructorOptions, WebPreferences } from 'electron';

export interface SettingsWindowDefinition {
  options: BrowserWindowConstructorOptions;
  htmlPath: string;
}

export function createWindowWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

export function createSettingsWindowDefinition(
  preload: string,
  htmlPath: string,
): SettingsWindowDefinition {
  return {
    htmlPath,
    options: {
      width: 720,
      height: 680,
      minWidth: 620,
      minHeight: 560,
      show: false,
      webPreferences: createWindowWebPreferences(preload),
    },
  };
}
