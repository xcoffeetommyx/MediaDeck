import { constants } from 'node:fs';
import { access, stat, statfs } from 'node:fs/promises';

import type { StoragePaths } from '@mediadeck/config';
import type {
  OperationalDiagnostics,
  OperationEventListResponse,
} from '@mediadeck/contracts';

import type { BackupManager } from './backup-manager.js';
import type { BrowserTransportProbe } from './browser-transport.js';
import type { SessionManager } from './session-manager.js';
import type { MediaDeckStore } from './store.js';

export class OperationsManager {
  constructor(
    private readonly appVersion: string,
    private readonly backups: BackupManager,
    private readonly paths: StoragePaths,
    private readonly probe: BrowserTransportProbe,
    private readonly sessions: SessionManager,
    private readonly store: MediaDeckStore,
    private readonly now: () => Date = () => new Date(),
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async diagnostics(): Promise<OperationalDiagnostics> {
    const [worker, backups, filesystem] = await Promise.all([
      this.probe.check().catch((error: unknown) => ({
        capabilities: {
          audio: false,
          gamepad: false,
          keyboard: false,
          pointer: false,
          reconnect: false,
          touch: false,
        },
        checkedAt: this.now().toISOString(),
        detail: error instanceof Error ? error.message : 'Worker health check failed',
        status: 'offline' as const,
        transport: {
          mode: 'websocket' as const,
          provider: 'selkies',
        },
      })),
      this.backups.list().catch(() => []),
      statfs(this.paths.root).catch(() => null),
    ]);
    const databaseSize = await stat(this.paths.databaseFile)
      .then((details) => details.size)
      .catch(() => 0);
    let storageWritable = true;
    try {
      await access(this.paths.root, constants.W_OK);
    } catch {
      storageWritable = false;
    }
    const databaseHealthy = (() => {
      try {
        return this.store.isHealthy();
      } catch {
        return false;
      }
    })();
    const degraded = !databaseHealthy || !storageWritable || worker.status !== 'online';

    return {
      activeSessions: this.store.listActiveSessions().length,
      checkedAt: this.now().toISOString(),
      database: {
        healthy: databaseHealthy,
        schemaVersion: this.store.getSchemaVersion(),
        sizeBytes: databaseSize,
      },
      failedSessions: this.store.getFailedSessionCount(),
      lastBackupAt: backups[0]?.createdAt ?? null,
      profiles: this.store.getProfileCount(),
      status: degraded ? 'degraded' : 'healthy',
      storage: {
        availableBytes: filesystem ? Number(filesystem.bavail * filesystem.bsize) : 0,
        writable: storageWritable,
      },
      uptimeSeconds: process.uptime(),
      version: this.appVersion,
      worker: {
        detail: worker.detail ?? null,
        status: worker.status,
      },
    };
  }

  logs(limit: number): OperationEventListResponse {
    return {
      events: this.store.listEvents(limit),
    };
  }

  async reconcile(): Promise<OperationalDiagnostics> {
    await this.sessions.reconcile();
    try {
      this.store.recordEvent(
        'recovery',
        'info',
        'Browser session reconciliation was run manually',
        this.now().toISOString(),
      );
    } catch (error) {
      this.onError(error);
    }
    return this.diagnostics();
  }
}
