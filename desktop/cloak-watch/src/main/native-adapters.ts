export interface NativeAdapters {
  playPing(): Promise<void>;
  showNotification(title: string, body: string): Promise<void>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  chooseLogDirectory(): Promise<string | null>;
  openLogDirectory(path: string): Promise<void>;
  showSettings(): void;
  quit(): void;
}

export interface NativeAdapterDependencies {
  sendToRenderer(channel: 'cloak-watch:play-ping'): void;
  notificationsSupported(): boolean;
  showNotification(title: string, body: string): void;
  setLoginItem(enabled: boolean): void;
  chooseLogDirectory(): Promise<string | null>;
  openPath(path: string): Promise<string>;
  showSettings(): void;
  quit(): void;
}

export function createNativeAdapters(dependencies: NativeAdapterDependencies): NativeAdapters {
  return {
    playPing: async () => {
      dependencies.sendToRenderer('cloak-watch:play-ping');
    },
    showNotification: async (title, body) => {
      if (!dependencies.notificationsSupported()) {
        throw new Error('Desktop notifications are not supported or permission was denied');
      }
      dependencies.showNotification(title, body);
    },
    setStartAtLogin: async (enabled) => {
      dependencies.setLoginItem(enabled);
    },
    chooseLogDirectory: () => dependencies.chooseLogDirectory(),
    openLogDirectory: async (path) => {
      const error = await dependencies.openPath(path);
      if (error) throw new Error(error);
    },
    showSettings: () => { dependencies.showSettings(); },
    quit: () => { dependencies.quit(); },
  };
}
