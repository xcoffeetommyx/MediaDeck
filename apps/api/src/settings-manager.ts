import {
  administratorSettingsSchema,
  type AdministratorSettings,
  type StreamQualityPreset,
  type UpdateAdministratorSettingsRequest,
} from '@mediadeck/contracts';

import { ConflictError } from './domain-errors.js';
import type { MediaDeckStore } from './store.js';

const settingsKey = 'administrator-settings';
export const streamQualityPresets: Record<
  StreamQualityPreset,
  { framerate: number; videoBitrate: number }
> = {
  'data-saver': { framerate: 30, videoBitrate: 3 },
  balanced: { framerate: 30, videoBitrate: 6 },
  smooth: { framerate: 60, videoBitrate: 6 },
  'high-quality': { framerate: 60, videoBitrate: 12 },
};

export function inferStreamQualityPreset(
  framerate: number,
  videoBitrate: number,
): StreamQualityPreset {
  const match = Object.entries(streamQualityPresets).find(
    ([, quality]) =>
      quality.framerate === framerate && quality.videoBitrate === videoBitrate,
  );
  return (match?.[0] as StreamQualityPreset | undefined) ?? 'balanced';
}

export class SettingsManager {
  constructor(
    private readonly store: MediaDeckStore,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly defaultStreamQualityPreset: StreamQualityPreset = 'balanced',
  ) {}

  get(): AdministratorSettings {
    const stored = this.store.getSetting(settingsKey);
    const defaults: AdministratorSettings = {
      automaticUpdateChecks: true,
      backupRetentionCount: 5,
      streamQualityPreset: this.defaultStreamQualityPreset,
    };
    if (!stored) return defaults;

    try {
      const parsed = administratorSettingsSchema.safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data : defaults;
    } catch {
      return defaults;
    }
  }

  update(input: UpdateAdministratorSettingsRequest): AdministratorSettings {
    const current = this.get();
    if (
      input.streamQualityPreset &&
      input.streamQualityPreset !== current.streamQualityPreset &&
      this.store.listActiveSessions().length > 0
    ) {
      throw new ConflictError(
        'Stop active Firefox sessions before changing stream quality',
      );
    }

    const settings = administratorSettingsSchema.parse({
      ...current,
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
