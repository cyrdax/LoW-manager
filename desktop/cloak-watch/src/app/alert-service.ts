import type { DecloakEvent } from '../core/types.js';

export interface AlertAdapters {
  playPing(): Promise<void>;
  showNotification(title: string, body: string): Promise<void>;
}

export interface AlertPreferences {
  soundEnabled: boolean;
  notificationsEnabled: boolean;
}

export interface AlertResult {
  soundError: string | null;
  notificationError: string | null;
}

export class AlertService {
  constructor(private readonly adapters: AlertAdapters) {}

  async deliver(event: DecloakEvent, preferences: AlertPreferences): Promise<AlertResult> {
    const [soundError, notificationError] = await Promise.all([
      preferences.soundEnabled ? this.deliverSound() : null,
      preferences.notificationsEnabled ? this.deliverNotification(event) : null,
    ]);
    return { soundError, notificationError };
  }

  test(preferences: AlertPreferences): Promise<AlertResult> {
    return this.deliver({
      characterName: 'Test alert',
      occurredAt: new Date().toISOString(),
      message: 'Cloak Watch alerts are working.',
      sourceFile: '',
      byteOffset: 0,
    }, preferences);
  }

  private async deliverSound(): Promise<string | null> {
    try {
      await this.adapters.playPing();
      return null;
    } catch (error) {
      return describe(error);
    }
  }

  private async deliverNotification(event: DecloakEvent): Promise<string | null> {
    try {
      await this.adapters.showNotification(`EVE decloak detected — ${event.characterName}`, event.message);
      return null;
    } catch (error) {
      return describe(error);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
