import {
  administratorSettingsSchema,
  type AdministratorSettings,
  type UpdateAdministratorSettingsRequest,
} from '@mediadeck/contracts';

import type { MediaDeckStore } from './store.js';

const settingsKey = 'administrator-settings';
const defaultSettings: AdministratorSettings = {
  automaticUpdateChecks: true,
  backupRetentionCount: 5,
};

export class SettingsManager {
  constructor(
    private readonly store: MediaDeckStore,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  get(): AdministratorSettings {
    const stored = this.store.getSetting(settingsKey);
    if (!stored) return defaultSettings;

    try {
      const parsed = administratorSettingsSchema.safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data : defaultSettings;
    } catch {
      return defaultSettings;
    }
  }

  update(input: UpdateAdministratorSettingsRequest): AdministratorSettings {
    const settings = administratorSettingsSchema.parse({
      ...this.get(),
      ...input,
    });
    this.store.setSetting(
      settingsKey,
      JSON.stringify(settings),
      this.now().toISOString(),
    );
    try {
      this.store.recordEvent(
        'administration',
        'info',
        'Administrator settings were updated',
        this.now().toISOString(),
      );
    } catch (error) {
      this.onError(error);
    }
    return settings;
  }
}
