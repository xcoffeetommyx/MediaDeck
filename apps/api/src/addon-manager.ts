import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AddonConfig, StoragePaths } from '@mediadeck/config';
import type { AddonWatchScanResponse, ProfileAddon } from '@mediadeck/contracts';

import { ConflictError, InvalidAddonError } from './domain-errors.js';
import { MediaDeckStore, type StoredProfileAddon } from './store.js';
import { inspectXpi } from './xpi-inspector.js';

type AddonSource = ProfileAddon['source'];

function toPublicAddon(addon: StoredProfileAddon): ProfileAddon {
  return {
    enabled: addon.enabled,
    id: addon.id,
    installedAt: addon.installedAt,
    maxFirefoxVersion: addon.maxFirefoxVersion,
    minFirefoxVersion: addon.minFirefoxVersion,
    name: addon.name,
    permissions: addon.permissions,
    profileId: addon.profileId,
    sha256: addon.sha256,
    source: addon.source,
    updatedAt: addon.updatedAt,
    version: addon.version,
  };
}

function compareAddonVersions(left: string, right: string): number {
  const tokenize = (value: string) =>
    value
      .split(/[.-]/)
      .flatMap((part) => part.match(/\d+|[A-Za-z]+/g) ?? [])
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftTokens[index];
    const b = rightTokens[index];
    if (a === b) continue;
    if (a === undefined) return typeof b === 'number' ? -1 : 1;
    if (b === undefined) return typeof a === 'number' ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return a > b ? 1 : -1;
    if (typeof a === 'number') return 1;
    if (typeof b === 'number') return -1;
    return a.localeCompare(b);
  }
  return 0;
}

export class AddonManager {
  readonly #config: AddonConfig;
  readonly #now: () => Date;
  readonly #onError: (error: unknown) => void;
  readonly #paths: StoragePaths;
  readonly #store: MediaDeckStore;
  #scanning = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: {
    config: AddonConfig;
    now?: () => Date;
    onError?: (error: unknown) => void;
    paths: StoragePaths;
    store: MediaDeckStore;
  }) {
    this.#config = options.config;
    this.#now = options.now ?? (() => new Date());
    this.#onError = options.onError ?? (() => undefined);
    this.#paths = options.paths;
    this.#store = options.store;
  }

  async initialize(): Promise<void> {
    await Promise.all(
      this.#store.listProfiles().map((profile) => this.prepareProfile(profile.id)),
    );
    if (!this.#config.watchEnabled) return;
    await this.scanWatchedDirectory().catch(this.#onError);
    this.#timer = setInterval(() => {
      void this.scanWatchedDirectory().catch(this.#onError);
    }, this.#config.watchIntervalSeconds * 1000);
    this.#timer.unref();
  }

  close(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  list(profileId: string): ProfileAddon[] {
    return this.#store.listProfileAddons(profileId).map(toPublicAddon);
  }

  async prepareProfile(profileId: string): Promise<void> {
    this.#store.requireProfile(profileId);
    await Promise.all([
      mkdir(this.addonDirectory(profileId), { recursive: true }),
      mkdir(this.policyDirectory(profileId), { recursive: true }),
    ]);
    await this.writePolicy(profileId);
  }

  async install(
    profileId: string,
    packageBytes: Buffer,
    source: AddonSource = 'upload',
  ): Promise<ProfileAddon> {
    this.#store.requireProfile(profileId);
    this.assertProfileInactive(profileId);
    if (
      packageBytes.length === 0 ||
      packageBytes.length > this.#config.maxPackageBytes
    ) {
      throw new InvalidAddonError(
        `The XPI must be between 1 byte and ${Math.floor(this.#config.maxPackageBytes / 1024 / 1024)} MiB`,
      );
    }
    const inspected = inspectXpi(packageBytes, this.#config.firefoxMajorVersion);
    const current = this.#store.getProfileAddon(profileId, inspected.id);
    if (current?.sha256 === inspected.sha256) return toPublicAddon(current);
    if (current && compareAddonVersions(inspected.version, current.version) <= 0) {
      throw new ConflictError(
        `Add-on ${inspected.id} must be updated to a version newer than ${current.version}`,
      );
    }

    await this.prepareProfile(profileId);
    const packageFilename = `${createHash('sha256')
      .update(inspected.id)
      .digest('hex')
      .slice(0, 24)}-${inspected.sha256.slice(0, 16)}.xpi`;
    const packagePath = resolve(this.addonDirectory(profileId), packageFilename);
    const temporaryPath = `${packagePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, packageBytes, { flag: 'wx', mode: 0o600 });
    try {
      await rename(temporaryPath, packagePath);
      const timestamp = this.#now().toISOString();
      const stored = this.#store.upsertProfileAddon({
        enabled: current?.enabled ?? true,
        id: inspected.id,
        installedAt: current?.installedAt ?? timestamp,
        maxFirefoxVersion: inspected.maxFirefoxVersion,
        minFirefoxVersion: inspected.minFirefoxVersion,
        name: inspected.name,
        packageFilename,
        permissions: inspected.permissions,
        profileId,
        sha256: inspected.sha256,
        source,
        updatedAt: timestamp,
        version: inspected.version,
      });
      await this.writePolicy(profileId);
      if (current && current.packageFilename !== packageFilename) {
        await rm(resolve(this.addonDirectory(profileId), current.packageFilename), {
          force: true,
        });
      }
      this.#store.recordEvent(
        'addon',
        'info',
        `${current ? 'Updated' : 'Installed'} ${stored.name} ${stored.version} for profile ${profileId}`,
        timestamp,
      );
      return toPublicAddon(stored);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async setEnabled(
    profileId: string,
    addonId: string,
    enabled: boolean,
  ): Promise<ProfileAddon> {
    this.#store.requireProfile(profileId);
    this.assertProfileInactive(profileId);
    const timestamp = this.#now().toISOString();
    const addon = this.#store.setProfileAddonEnabled(
      profileId,
      addonId,
      enabled,
      timestamp,
    );
    await this.writePolicy(profileId);
    this.#store.recordEvent(
      'addon',
      'info',
      `${enabled ? 'Enabled' : 'Disabled'} ${addon.name} for profile ${profileId}`,
      timestamp,
    );
    return toPublicAddon(addon);
  }

  async remove(profileId: string, addonId: string): Promise<void> {
    this.#store.requireProfile(profileId);
    this.assertProfileInactive(profileId);
    const addon = this.#store.deleteProfileAddon(profileId, addonId);
    await this.writePolicy(profileId);
    await rm(resolve(this.addonDirectory(profileId), addon.packageFilename), {
      force: true,
    });
    this.#store.recordEvent(
      'addon',
      'warning',
      `Removed ${addon.name} from profile ${profileId}`,
      this.#now().toISOString(),
    );
  }

  async scanWatchedDirectory(): Promise<AddonWatchScanResponse> {
    if (this.#scanning) {
      return { imported: 0, rejected: 0, skipped: 1 };
    }
    this.#scanning = true;
    const result: AddonWatchScanResponse = {
      imported: 0,
      rejected: 0,
      skipped: 0,
    };
    try {
      const profileDirectories = await readdir(this.#paths.addonInbox, {
        withFileTypes: true,
      });
      for (const profileDirectory of profileDirectories) {
        if (!profileDirectory.isDirectory()) {
          result.skipped += 1;
          continue;
        }
        const profileId = profileDirectory.name;
        try {
          this.#store.requireProfile(profileId);
        } catch {
          result.skipped += 1;
          continue;
        }
        if (this.#store.findActiveSessionByProfile(profileId)) {
          result.skipped += 1;
          continue;
        }
        const inbox = resolve(this.#paths.addonInbox, profileId);
        const files = await readdir(inbox, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.toLowerCase().endsWith('.xpi')) {
            result.skipped += 1;
            continue;
          }
          const sourcePath = resolve(inbox, file.name);
          try {
            const details = await stat(sourcePath);
            if (details.size > this.#config.maxPackageBytes) {
              throw new InvalidAddonError('The watched XPI exceeds the size limit');
            }
            await this.install(profileId, await readFile(sourcePath), 'watched');
            await rm(sourcePath, { force: true });
            result.imported += 1;
          } catch (error) {
            await this.rejectWatchedPackage(profileId, file.name, sourcePath, error);
            result.rejected += 1;
          }
        }
      }
      return result;
    } finally {
      this.#scanning = false;
    }
  }

  private assertProfileInactive(profileId: string): void {
    if (this.#store.findActiveSessionByProfile(profileId)) {
      throw new ConflictError(
        'Stop this profile’s active Firefox session before changing add-ons',
      );
    }
  }

  private addonDirectory(profileId: string): string {
    return resolve(this.#paths.profiles, profileId, 'firefox', 'mediadeck', 'addons');
  }

  private policyDirectory(profileId: string): string {
    return resolve(this.#paths.profiles, profileId, 'firefox', 'mediadeck', 'policy');
  }

  private async writePolicy(profileId: string): Promise<void> {
    const extensionSettings = Object.fromEntries(
      this.#store.listProfileAddons(profileId).map((addon) => [
        addon.id,
        addon.enabled
          ? {
              install_url: `file:///config/mediadeck/addons/${addon.packageFilename}`,
              installation_mode: 'force_installed',
              updates_disabled: true,
            }
          : {
              installation_mode: 'blocked',
            },
      ]),
    );
    const policyPath = resolve(this.policyDirectory(profileId), 'policies.json');
    const temporaryPath = `${policyPath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        {
          policies: {
            ExtensionSettings: extensionSettings,
          },
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await rename(temporaryPath, policyPath);
  }

  private async rejectWatchedPackage(
    profileId: string,
    filename: string,
    sourcePath: string,
    error: unknown,
  ): Promise<void> {
    const rejectedDirectory = resolve(this.#paths.addonRejected, profileId);
    await mkdir(rejectedDirectory, { recursive: true });
    const prefix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const rejectedPath = resolve(rejectedDirectory, `${prefix}-${filename}`);
    await rename(sourcePath, rejectedPath);
    await writeFile(
      `${rejectedPath}.error.json`,
      `${JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown add-on error',
        rejectedAt: this.#now().toISOString(),
      })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    this.#store.recordEvent(
      'addon',
      'warning',
      `Rejected watched add-on ${filename} for profile ${profileId}`,
      this.#now().toISOString(),
    );
  }
}
