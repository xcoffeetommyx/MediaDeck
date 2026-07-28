import { randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

import type { StoragePaths } from '@mediadeck/config';
import {
  backupSummarySchema,
  type BackupSummary,
  type RestoreBackupResponse,
} from '@mediadeck/contracts';
import { z } from 'zod';

import { ConflictError, NotFoundError } from './domain-errors.js';
import type { MediaDeckStore } from './store.js';

const manifestFilename = 'manifest.json';
const restoreRequestFilename = 'restore-request.json';

const backupManifestSchema = backupSummarySchema.extend({
  databaseFile: z.literal('database/mediadeck.sqlite'),
  formatVersion: z.literal(1),
  profilesDirectory: z.literal('profiles'),
});

const restoreRequestSchema = z.object({
  backupId: backupSummarySchema.shape.id,
  scheduledAt: z.iso.datetime(),
});

type BackupManifest = z.infer<typeof backupManifestSchema>;

function safeChild(root: string, name: string): string {
  if (basename(name) !== name) {
    throw new Error('Backup identifier contains a path separator');
  }
  const target = resolve(root, name);
  const relativeTarget = relative(resolve(root), target);
  if (
    !relativeTarget ||
    relativeTarget.startsWith('..') ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('Backup path escaped the configured backup directory');
  }
  return target;
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function readManifest(directory: string): Promise<BackupManifest> {
  const contents = await readFile(resolve(directory, manifestFilename), 'utf8');
  return backupManifestSchema.parse(JSON.parse(contents));
}

export class BackupManager {
  constructor(
    private readonly appVersion: string,
    private readonly paths: StoragePaths,
    private readonly store: MediaDeckStore,
    private readonly retentionCount: () => number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<BackupSummary[]> {
    const entries = await readdir(this.paths.backups, { withFileTypes: true });
    const backups: BackupSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        backups.push(await readManifest(safeChild(this.paths.backups, entry.name)));
      } catch {
        // Incomplete or manually modified directories are not restorable backups.
      }
    }

    return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(): Promise<BackupSummary> {
    if (this.store.listActiveSessions().length > 0) {
      throw new ConflictError('Stop active browser sessions before creating a backup');
    }

    const createdAt = this.now().toISOString();
    const id = `${createdAt.replaceAll(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
    const temporary = safeChild(this.paths.backups, `.creating-${id}`);
    const destination = safeChild(this.paths.backups, id);
    const databaseDirectory = resolve(temporary, 'database');
    const profilesDirectory = resolve(temporary, 'profiles');

    await mkdir(databaseDirectory, { recursive: true });
    await cp(this.paths.profiles, profilesDirectory, { recursive: true });

    try {
      await this.store.backupDatabase(resolve(databaseDirectory, 'mediadeck.sqlite'));
      const profileCount = this.store.getProfileCount();
      const manifest: BackupManifest = {
        appVersion: this.appVersion,
        createdAt,
        databaseFile: 'database/mediadeck.sqlite',
        formatVersion: 1,
        id,
        profileCount,
        profilesDirectory: 'profiles',
        schemaVersion: this.store.getSchemaVersion(),
        sizeBytes: await directorySize(temporary),
      };
      await writeJsonAtomically(resolve(temporary, manifestFilename), manifest);
      await rename(temporary, destination);
      this.store.recordEvent('backup', 'info', `Backup ${id} was created`, createdAt);
      await this.enforceRetention();
      return manifest;
    } catch (error) {
      await rm(temporary, { force: true, recursive: true });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const directory = safeChild(this.paths.backups, id);
    try {
      await readManifest(directory);
    } catch {
      throw new NotFoundError(`Backup ${id} was not found`);
    }
    await rm(directory, { recursive: true });
    this.store.recordEvent('backup', 'warning', `Backup ${id} was deleted`);
  }

  async scheduleRestore(id: string): Promise<RestoreBackupResponse> {
    if (this.store.listActiveSessions().length > 0) {
      throw new ConflictError(
        'Stop active browser sessions before scheduling a restore',
      );
    }
    const directory = safeChild(this.paths.backups, id);
    try {
      await readManifest(directory);
    } catch {
      throw new NotFoundError(`Backup ${id} was not found`);
    }

    const scheduledAt = this.now().toISOString();
    await writeJsonAtomically(resolve(this.paths.runtime, restoreRequestFilename), {
      backupId: id,
      scheduledAt,
    });
    this.store.recordEvent(
      'backup',
      'warning',
      `Restore from backup ${id} was scheduled for the next restart`,
      scheduledAt,
    );
    return {
      backupId: id,
      restartRequired: true,
      scheduledAt,
    };
  }

  private async enforceRetention(): Promise<void> {
    const backups = await this.list();
    for (const backup of backups.slice(this.retentionCount())) {
      await rm(safeChild(this.paths.backups, backup.id), {
        recursive: true,
      });
    }
  }
}

export async function applyScheduledRestore(
  paths: StoragePaths,
): Promise<string | null> {
  const requestPath = resolve(paths.runtime, restoreRequestFilename);
  let request: z.infer<typeof restoreRequestSchema>;
  try {
    request = restoreRequestSchema.parse(
      JSON.parse(await readFile(requestPath, 'utf8')),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error('The pending restore request is invalid', { cause: error });
  }

  const source = safeChild(paths.backups, request.backupId);
  await readManifest(source);
  const sourceDatabase = resolve(source, 'database', 'mediadeck.sqlite');
  const sourceProfiles = resolve(source, 'profiles');
  const restoreDatabase = `${paths.databaseFile}.restore`;
  const previousDatabase = `${paths.databaseFile}.previous`;
  const previousProfiles = resolve(paths.runtime, 'profiles-before-restore');

  await rm(restoreDatabase, { force: true });
  await rm(previousDatabase, { force: true });
  await rm(previousProfiles, { force: true, recursive: true });
  await cp(sourceDatabase, restoreDatabase);

  let databaseMoved = false;
  let profilesMoved = false;
  try {
    try {
      await rename(paths.databaseFile, previousDatabase);
      databaseMoved = true;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    await rename(restoreDatabase, paths.databaseFile);

    await rename(paths.profiles, previousProfiles);
    profilesMoved = true;
    await cp(sourceProfiles, paths.profiles, { recursive: true });

    await rm(`${paths.databaseFile}-wal`, { force: true });
    await rm(`${paths.databaseFile}-shm`, { force: true });
    await rm(previousDatabase, { force: true });
    await rm(previousProfiles, { force: true, recursive: true });
    await rm(requestPath);
    return request.backupId;
  } catch (error) {
    await rm(paths.databaseFile, { force: true });
    if (databaseMoved) await rename(previousDatabase, paths.databaseFile);
    if (profilesMoved) {
      await rm(paths.profiles, { force: true, recursive: true });
      await rename(previousProfiles, paths.profiles);
    }
    throw error;
  }
}
