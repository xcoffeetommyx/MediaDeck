import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { StoragePaths } from '@mediadeck/config';
import {
  updateManifestSchema,
  updateStatusSchema,
  type UpdateStatus,
} from '@mediadeck/contracts';

import type { BackupManager } from './backup-manager.js';
import { ConflictError } from './domain-errors.js';
import type { MediaDeckStore } from './store.js';

const updateStateKey = 'update-status';
const automaticCheckIntervalMilliseconds = 6 * 60 * 60 * 1000;

type FetchFunction = typeof fetch;

function versionParts(version: string): number[] {
  return version
    .split('-', 1)[0]!
    .split('.')
    .map((part) => Number.parseInt(part, 10));
}

function isNewerVersion(candidate: string, installed: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(installed);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export class UpdateManager {
  readonly #appVersion: string;
  readonly #backups: BackupManager;
  readonly #fetch: FetchFunction;
  readonly #manifestUrl: string | undefined;
  readonly #now: () => Date;
  readonly #paths: StoragePaths;
  readonly #store: MediaDeckStore;
  #initialTimer: NodeJS.Timeout | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: {
    appVersion: string;
    backups: BackupManager;
    fetch?: FetchFunction;
    manifestUrl?: string;
    now?: () => Date;
    paths: StoragePaths;
    store: MediaDeckStore;
  }) {
    this.#appVersion = options.appVersion;
    this.#backups = options.backups;
    this.#fetch = options.fetch ?? fetch;
    this.#manifestUrl = options.manifestUrl;
    this.#now = options.now ?? (() => new Date());
    this.#paths = options.paths;
    this.#store = options.store;
  }

  initialize(automaticChecks: boolean): void {
    if (!automaticChecks || !this.#manifestUrl || this.#timer) return;
    this.#initialTimer = setTimeout(() => {
      this.#initialTimer = undefined;
      void this.check();
    }, 1_000);
    this.#initialTimer.unref();
    this.#timer = setInterval(() => {
      void this.check();
    }, automaticCheckIntervalMilliseconds);
    this.#timer.unref();
  }

  close(): void {
    if (this.#initialTimer) {
      clearTimeout(this.#initialTimer);
      this.#initialTimer = undefined;
    }
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  setAutomaticChecks(enabled: boolean): void {
    this.close();
    this.initialize(enabled);
  }

  getStatus(): UpdateStatus {
    if (!this.#manifestUrl) {
      return {
        approvedAt: null,
        backupId: null,
        checkedAt: null,
        installedVersion: this.#appVersion,
        manifestConfigured: false,
        message: 'Set MEDIADECK_UPDATE_MANIFEST_URL to enable release checks.',
        release: null,
        state: 'unconfigured',
      };
    }

    const stored = this.#store.getSetting(updateStateKey);
    if (!stored) {
      return {
        approvedAt: null,
        backupId: null,
        checkedAt: null,
        installedVersion: this.#appVersion,
        manifestConfigured: true,
        message: 'No update check has run yet.',
        release: null,
        state: 'current',
      };
    }

    let parsed: ReturnType<typeof updateStatusSchema.safeParse>;
    try {
      parsed = updateStatusSchema.safeParse(JSON.parse(stored));
    } catch {
      parsed = updateStatusSchema.safeParse(null);
    }
    if (!parsed.success) {
      return {
        approvedAt: null,
        backupId: null,
        checkedAt: null,
        installedVersion: this.#appVersion,
        manifestConfigured: true,
        message: 'Stored update status was invalid. Run a new check.',
        release: null,
        state: 'error',
      };
    }

    const status = {
      ...parsed.data,
      installedVersion: this.#appVersion,
      manifestConfigured: true,
    };
    if (status.release && !isNewerVersion(status.release.version, this.#appVersion)) {
      return {
        ...status,
        approvedAt: null,
        backupId: null,
        message: 'MediaDeck is current.',
        release: null,
        state: 'current',
      };
    }
    return status;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.#manifestUrl) return this.getStatus();
    const checkedAt = this.#now().toISOString();

    try {
      const response = await this.#fetch(this.#manifestUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `MediaDeck/${this.#appVersion}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`The release service returned HTTP ${response.status}`);
      }
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > 65_536) {
        throw new Error('The release manifest exceeded 64 KB');
      }
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > 65_536) {
        throw new Error('The release manifest exceeded 64 KB');
      }
      const manifest = updateManifestSchema.parse(JSON.parse(body));
      const available = isNewerVersion(manifest.version, this.#appVersion);
      const status: UpdateStatus = {
        approvedAt: null,
        backupId: null,
        checkedAt,
        installedVersion: this.#appVersion,
        manifestConfigured: true,
        message: available
          ? `MediaDeck ${manifest.version} is available.`
          : 'MediaDeck is current.',
        release: available
          ? {
              image: manifest.image,
              publishedAt: manifest.publishedAt,
              ...(manifest.releaseNotesUrl
                ? { releaseNotesUrl: manifest.releaseNotesUrl }
                : {}),
              version: manifest.version,
            }
          : null,
        state: available ? 'available' : 'current',
      };
      this.persist(status);
      this.#store.recordEvent(
        'update',
        'info',
        available
          ? `Update ${manifest.version} is available`
          : 'Update check completed; MediaDeck is current',
        checkedAt,
      );
      return status;
    } catch (error) {
      const status: UpdateStatus = {
        approvedAt: null,
        backupId: null,
        checkedAt,
        installedVersion: this.#appVersion,
        manifestConfigured: true,
        message:
          error instanceof Error
            ? `Update check failed: ${error.message}`
            : 'Update check failed',
        release: null,
        state: 'error',
      };
      this.persist(status);
      this.#store.recordEvent(
        'update',
        'error',
        status.message ?? 'Update check failed',
        checkedAt,
      );
      return status;
    }
  }

  async approve(version: string): Promise<UpdateStatus> {
    const current = this.getStatus();
    if (current.state !== 'available' || !current.release) {
      throw new ConflictError('There is no available update to approve');
    }
    if (current.release.version !== version) {
      throw new ConflictError('The available release changed; check again');
    }

    const backup = await this.#backups.create();
    const approvedAt = this.#now().toISOString();
    const status: UpdateStatus = {
      ...current,
      approvedAt,
      backupId: backup.id,
      message:
        'Update approved and backed up. Apply the pinned image with the host runbook.',
      state: 'approved',
    };
    this.persist(status);
    await this.writeApprovedPlan(status);
    this.#store.recordEvent(
      'update',
      'warning',
      `Update ${version} was approved with backup ${backup.id}`,
      approvedAt,
    );
    return status;
  }

  private persist(status: UpdateStatus): void {
    this.#store.setSetting(
      updateStateKey,
      JSON.stringify(status),
      this.#now().toISOString(),
    );
  }

  private async writeApprovedPlan(status: UpdateStatus): Promise<void> {
    const destination = resolve(this.#paths.runtime, 'approved-update.json');
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(
        {
          approvedAt: status.approvedAt,
          backupId: status.backupId,
          image: status.release?.image,
          installedVersion: status.installedVersion,
          version: status.release?.version,
        },
        null,
        2,
      )}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
    await rename(temporary, destination);
  }
}
