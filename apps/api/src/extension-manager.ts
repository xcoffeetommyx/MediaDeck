import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  ChromeExtension,
  CreateChromeExtensionRequest,
} from '@mediadeck/contracts';
import type { StoragePaths } from '@mediadeck/config';

import { ConflictError } from './domain-errors.js';
import { OperationCoordinator } from './operation-coordinator.js';
import { MediaDeckStore } from './store.js';

const chromeWebStoreUpdateUrl = 'https://clients2.google.com/service/update2/crx';

export class ExtensionManager {
  constructor(
    private readonly store: MediaDeckStore,
    private readonly paths: StoragePaths,
    private readonly now: () => Date = () => new Date(),
    private readonly operations: OperationCoordinator = new OperationCoordinator(),
  ) {}

  async initialize(): Promise<void> {
    await Promise.all(
      this.store.listProfiles().map((profile) => this.prepareProfile(profile.id)),
    );
  }

  list(profileId: string): ChromeExtension[] {
    return this.store.listChromeExtensions(profileId);
  }

  async add(
    profileId: string,
    input: CreateChromeExtensionRequest,
  ): Promise<ChromeExtension> {
    return this.operations.run(async () => {
      this.assertProfileInactive(profileId);
      if (this.store.getChromeExtension(profileId, input.id)) {
        throw new ConflictError('This extension is already managed for the profile');
      }
      const timestamp = this.now().toISOString();
      const extension = this.store.createChromeExtension({
        enabled: true,
        id: input.id,
        installedAt: timestamp,
        name: input.name,
        profileId,
        updatedAt: timestamp,
      });
      try {
        await this.writePolicy(profileId);
      } catch (error) {
        this.store.deleteChromeExtension(profileId, input.id);
        throw error;
      }
      this.recordEvent(`Added ${extension.name} to profile ${profileId}`);
      return extension;
    });
  }

  async setEnabled(
    profileId: string,
    extensionId: string,
    enabled: boolean,
  ): Promise<ChromeExtension> {
    return this.operations.run(async () => {
      this.assertProfileInactive(profileId);
      const current = this.store.getChromeExtension(profileId, extensionId);
      if (!current) {
        return this.store.setChromeExtensionEnabled(
          profileId,
          extensionId,
          enabled,
          this.now().toISOString(),
        );
      }
      const updated = this.store.setChromeExtensionEnabled(
        profileId,
        extensionId,
        enabled,
        this.now().toISOString(),
      );
      try {
        await this.writePolicy(profileId);
      } catch (error) {
        this.store.setChromeExtensionEnabled(
          profileId,
          extensionId,
          current.enabled,
          current.updatedAt,
        );
        throw error;
      }
      this.recordEvent(
        `${enabled ? 'Enabled' : 'Disabled'} ${updated.name} for profile ${profileId}`,
      );
      return updated;
    });
  }

  async remove(profileId: string, extensionId: string): Promise<void> {
    await this.operations.run(async () => {
      this.assertProfileInactive(profileId);
      const removed = this.store.deleteChromeExtension(profileId, extensionId);
      try {
        await this.writePolicy(profileId);
      } catch (error) {
        this.store.createChromeExtension(removed);
        throw error;
      }
      this.recordEvent(`Removed ${removed.name} from profile ${profileId}`);
    });
  }

  async prepareProfile(profileId: string): Promise<void> {
    this.store.requireProfile(profileId);
    await this.writePolicy(profileId);
  }

  policyStoragePath(profileId: string): string {
    return `profiles/${profileId}/brave-origin/mediadeck/policy`;
  }

  private assertProfileInactive(profileId: string): void {
    this.store.requireProfile(profileId);
    if (this.store.findActiveSessionByProfile(profileId)) {
      throw new ConflictError(
        'Stop the active profile session before changing extensions',
      );
    }
  }

  private async writePolicy(profileId: string): Promise<void> {
    const directory = resolve(
      this.paths.profiles,
      profileId,
      'brave-origin',
      'mediadeck',
      'policy',
    );
    await mkdir(directory, { recursive: true });
    const extensionSettings = Object.fromEntries(
      this.store.listChromeExtensions(profileId).map((extension) => [
        extension.id,
        extension.enabled
          ? {
              installation_mode: 'force_installed',
              update_url: chromeWebStoreUpdateUrl,
            }
          : { installation_mode: 'blocked' },
      ]),
    );
    const policy = `${JSON.stringify(
      { ExtensionSettings: extensionSettings },
      null,
      2,
    )}\n`;
    const temporaryPath = resolve(directory, '.mediadeck.json.tmp');
    const policyPath = resolve(directory, 'mediadeck.json');
    await writeFile(temporaryPath, policy, { encoding: 'utf8', mode: 0o644 });
    await rename(temporaryPath, policyPath);
  }

  private recordEvent(message: string): void {
    try {
      this.store.recordEvent('extension', 'info', message, this.now().toISOString());
    } catch {
      // Extension state and policy remain authoritative if audit logging fails.
    }
  }
}
