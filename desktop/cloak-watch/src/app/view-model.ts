export interface AppViewModel {
  statusText: string;
  activeLogs: number;
  logDirectory: string | null;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  startAtLogin: boolean;
  latestEventText: string;
  warning: string | null;
}
