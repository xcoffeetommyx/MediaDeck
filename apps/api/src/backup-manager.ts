import { randomUUID } from 'node:crypto';
import {
  access,
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
import { OperationCoordinator } from './operation-coordinator.js';
import type { MediaDeckStore } from './store.js';

const manifestFilename = 'manifest.json';
const restoreRequestFilename = 'restore-request.json';
const completedRestoreFilename = 'restore-request.completed';

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
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
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
    private readonly operations: OperationCoordinator = new OperationCoordinator(),
    private readonly onError: (error: unknown) => void = () => undefined,
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
    return this.operations.run(() => this.createUnlocked());
  }

  private async createUnlocked(): Promise<BackupSummary> {
    if (this.store.listActiveSessions().length > 0) {
      throw new ConflictError('Stop active browser sessions before creating a backup');
    }

    const createdAt = this.now().toISOString();
    const id = `${createdAt.replaceAll(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
    const temporary = safeChild(this.paths.backups, `.creating-${id}`);
    const destination = safeChild(this.paths.backups, id);
    const databaseDirectory = resolve(temporary, 'database');
    const profilesDirectory = resolve(temporary, 'profiles');

    let manifest: BackupManifest;
    try {
      await mkdir(databaseDirectory, { recursive: true });
      await cp(this.paths.profiles, profilesDirectory, { recursive: true });
      await this.store.backupDatabase(resolve(databaseDirectory, 'mediadeck.sqlite'));
      const profileCount = this.store.getProfileCount();
      manifest = {
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
    } catch (error) {
      await rm(temporary, { force: true, recursive: true });
      throw error;
    }
    this.recordEventSafely('info', `Backup ${id} was created`, createdAt);
    await this.enforceRetention().catch(this.onError);
    return manifest;
  }

  async delete(id: string): Promise<void> {
    const directory = safeChild(this.paths.backups, id);
    try {
      await readManifest(directory);
    } catch {
      throw new NotFoundError(`Backup ${id} was not found`);
    }
    await rm(directory, { recursive: true });
    this.recordEventSafely('warning', `Backup ${id} was deleted`);
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
    this.recordEventSafely(
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

  private recordEventSafely(
    level: 'error' | 'info' | 'warning',
    message: string,
    createdAt = this.now().toISOString(),
  ): void {
    try {
      this.store.recordEvent('backup', level, message, createdAt);
    } catch (error) {
      this.onError(error);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function restoreArtifactPaths(paths: StoragePaths) {
  return {
    completedRequest: resolve(paths.runtime, completedRestoreFilename),
    previousDatabase: `${paths.databaseFile}.previous`,
    previousProfiles: resolve(paths.runtime, 'profiles-before-restore'),
    request: resolve(paths.runtime, restoreRequestFilename),
    restoreDatabase: `${paths.databaseFile}.restore`,
  };
}

async function rollbackInterruptedRestore(paths: StoragePaths): Promise<void> {
  const artifacts = restoreArtifactPaths(paths);
  if (await exists(artifacts.previousDatabase)) {
    await rm(paths.databaseFile, { force: true });
    await rm(`${paths.databaseFile}-wal`, { force: true });
    await rm(`${paths.databaseFile}-shm`, { force: true });
    await rename(artifacts.previousDatabase, paths.databaseFile);
  }
  if (await exists(artifacts.previousProfiles)) {
    await rm(paths.profiles, { force: true, recursive: true });
    await rename(artifacts.previousProfiles, paths.profiles);
  }
  await rm(artifacts.restoreDatabase, { force: true });
}

async function cleanupCompletedRestore(paths: StoragePaths): Promise<void> {
  const artifacts = restoreArtifactPaths(paths);
  if (!(await exists(artifacts.completedRequest))) return;
  await rm(artifacts.previousDatabase, { force: true });
  await rm(artifacts.previousProfiles, { force: true, recursive: true });
  await rm(artifacts.restoreDatabase, { force: true });
  await rm(artifacts.completedRequest, { force: true });
}

export async function applyScheduledRestore(
  paths: StoragePaths,
): Promise<string | null> {
  await cleanupCompletedRestore(paths);
  const artifacts = restoreArtifactPaths(paths);
  let request: z.infer<typeof restoreRequestSchema>;
  try {
    request = restoreRequestSchema.parse(
      JSON.parse(await readFile(artifacts.request, 'utf8')),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error('The pending restore request is invalid', { cause: error });
  }

  await rollbackInterruptedRestore(paths);
  const source = safeChild(paths.backups, request.backupId);
  await readManifest(source);
  const sourceDatabase = resolve(source, 'database', 'mediadeck.sqlite');
  const sourceProfiles = resolve(source, 'profiles');
  await cp(sourceDatabase, artifacts.restoreDatabase);

  try {
    try {
      await rename(paths.databaseFile, artifacts.previousDatabase);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    await rename(artifacts.restoreDatabase, paths.databaseFile);

    await rename(paths.profiles, artifacts.previousProfiles);
    await cp(sourceProfiles, paths.profiles, { recursive: true });
    await rename(artifacts.request, artifacts.completedRequest);
  } catch (error) {
    await rollbackInterruptedRestore(paths);
    throw error;
  }

  try {
    await rm(`${paths.databaseFile}-wal`, { force: true });
    await rm(`${paths.databaseFile}-shm`, { force: true });
    await rm(artifacts.previousDatabase, { force: true });
    await rm(artifacts.previousProfiles, { force: true, recursive: true });
    await rm(artifacts.restoreDatabase, { force: true });
    await rm(artifacts.completedRequest, { force: true });
  } catch {
    // Keep the completion marker so startup retries artifact cleanup safely.
  }
  return request.backupId;
}
