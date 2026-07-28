import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { StoragePaths } from '@mediadeck/config';
import type { BrowserSession, CreateBrowserSessionRequest } from '@mediadeck/contracts';

import type {
  BrowserWorkerDriver,
  BrowserWorkerState,
} from './browser-worker-driver.js';
import { ConflictError, WorkerUnavailableError } from './domain-errors.js';
import { MediaDeckStore, type StoredBrowserSession } from './store.js';

type SessionManagerOptions = {
  healthIntervalSeconds: number;
  idleTimeoutSeconds: number;
  maxSessions: number;
  now?: () => Date;
  onMonitorError?: (error: unknown) => void;
  paths: StoragePaths;
  store: MediaDeckStore;
  workerDriver: BrowserWorkerDriver;
};

const activeStatuses = new Set(['starting', 'running', 'stopping']);

function toPublicSession(session: StoredBrowserSession): BrowserSession {
  return {
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    failureReason: session.failureReason,
    id: session.id,
    kind: session.kind,
    lastSeenAt: session.lastSeenAt,
    profileId: session.profileId,
    status: session.status,
    updatedAt: session.updatedAt,
  };
}

export class SessionManager {
  readonly #healthIntervalMilliseconds: number;
  readonly #idleTimeoutMilliseconds: number;
  readonly #maxSessions: number;
  readonly #now: () => Date;
  readonly #onMonitorError: (error: unknown) => void;
  readonly #paths: StoragePaths;
  readonly #store: MediaDeckStore;
  readonly #workerDriver: BrowserWorkerDriver;
  #monitoring = false;
  #timer: NodeJS.Timeout | undefined;

  constructor({
    healthIntervalSeconds,
    idleTimeoutSeconds,
    maxSessions,
    now = () => new Date(),
    onMonitorError = () => undefined,
    paths,
    store,
    workerDriver,
  }: SessionManagerOptions) {
    this.#healthIntervalMilliseconds = healthIntervalSeconds * 1000;
    this.#idleTimeoutMilliseconds = idleTimeoutSeconds * 1000;
    this.#maxSessions = maxSessions;
    this.#now = now;
    this.#onMonitorError = onMonitorError;
    this.#paths = paths;
    this.#store = store;
    this.#workerDriver = workerDriver;
  }

  async initialize(): Promise<void> {
    await this.reconcile();
    this.#timer = setInterval(() => {
      void this.monitor().catch(this.#onMonitorError);
    }, this.#healthIntervalMilliseconds);
    this.#timer.unref();
  }

  async start(input: CreateBrowserSessionRequest): Promise<BrowserSession> {
    const id = randomUUID();
    const timestamp = this.#now().toISOString();
    const storagePath =
      input.kind === 'profile'
        ? `profiles/${input.profileId}/firefox`
        : `runtime/guests/${id}/firefox`;
    const filesystemPath =
      input.kind === 'profile'
        ? resolve(this.#paths.profiles, input.profileId, 'firefox')
        : resolve(this.#paths.guests, id, 'firefox');

    const session = this.#store.createSession(
      {
        createdAt: timestamp,
        id,
        kind: input.kind,
        lastSeenAt: timestamp,
        profileId: input.kind === 'profile' ? input.profileId : null,
        storagePath,
        updatedAt: timestamp,
      },
      this.#maxSessions,
    );

    try {
      await mkdir(filesystemPath, { recursive: true });
      return toPublicSession(await this.startWorker(session));
    } catch (error) {
      const failed = this.markFailed(
        session.id,
        error instanceof Error ? error.message : 'Browser worker failed to start',
      );
      if (failed.kind === 'guest') {
        await this.cleanupGuest(failed);
      }

      if (error instanceof WorkerUnavailableError) {
        throw error;
      }
      throw new WorkerUnavailableError(
        error instanceof Error ? error.message : 'Browser worker failed to start',
      );
    }
  }

  list(): BrowserSession[] {
    return this.#store.listSessions().map(toPublicSession);
  }

  get(id: string): BrowserSession {
    return toPublicSession(this.#store.requireSession(id));
  }

  async heartbeat(id: string): Promise<BrowserSession> {
    const session = this.#store.requireSession(id);
    if (!activeStatuses.has(session.status)) {
      throw new ConflictError('Only an active browser session can be refreshed');
    }

    const timestamp = this.#now().toISOString();
    if (!session.workerId) {
      return toPublicSession(
        this.#store.updateSession(id, {
          lastSeenAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    }

    let state: BrowserWorkerState;
    try {
      state = await this.#workerDriver.inspect(session.workerId);
    } catch (error) {
      throw new WorkerUnavailableError(
        error instanceof Error
          ? error.message
          : 'Browser worker health could not be read',
      );
    }
    if (state === 'running') {
      return toPublicSession(
        this.#store.updateSession(id, {
          lastSeenAt: timestamp,
          status: 'running',
          updatedAt: timestamp,
        }),
      );
    }

    if (state === 'starting') {
      return toPublicSession(
        this.#store.updateSession(id, {
          lastSeenAt: timestamp,
          status: 'starting',
          updatedAt: timestamp,
        }),
      );
    }

    this.#store.updateSession(id, {
      lastSeenAt: timestamp,
      updatedAt: timestamp,
    });
    return this.recover(id);
  }

  async stop(id: string): Promise<BrowserSession> {
    let session = this.#store.requireSession(id);
    if (session.status === 'stopped') {
      return toPublicSession(session);
    }

    const timestamp = this.#now().toISOString();
    session = this.#store.updateSession(id, {
      status: 'stopping',
      updatedAt: timestamp,
    });

    try {
      if (session.workerId) {
        await this.#workerDriver.stop(session.workerId);
      }

      const endedAt = this.#now().toISOString();
      session = this.#store.updateSession(id, {
        endedAt,
        failureReason: null,
        status: 'stopped',
        updatedAt: endedAt,
        workerId: null,
      });
    } catch (error) {
      this.#store.updateSession(id, {
        failureReason:
          error instanceof Error ? error.message : 'Browser worker failed to stop',
        status: 'stopping',
        updatedAt: this.#now().toISOString(),
      });
      throw new WorkerUnavailableError(
        error instanceof Error ? error.message : 'Browser worker failed to stop',
      );
    }

    if (session.kind === 'guest') {
      await this.cleanupGuest(session);
    }

    return toPublicSession(session);
  }

  async recover(id: string): Promise<BrowserSession> {
    const current = this.#store.requireSession(id);
    if (current.status === 'stopped' || current.status === 'stopping') {
      throw new ConflictError('A stopped browser session cannot be recovered');
    }

    if (current.workerId) {
      try {
        await this.#workerDriver.stop(current.workerId);
      } catch (error) {
        throw new WorkerUnavailableError(
          error instanceof Error
            ? error.message
            : 'The previous browser worker could not be removed',
        );
      }
    }

    const session = this.#store.reactivateSession(
      id,
      this.#maxSessions,
      this.#now().toISOString(),
    );

    try {
      await mkdir(this.sessionFilesystemPath(session), { recursive: true });
      return toPublicSession(await this.startWorker(session));
    } catch (error) {
      const failed = this.markFailed(
        id,
        error instanceof Error ? error.message : 'Browser worker recovery failed',
      );
      if (failed.kind === 'guest') {
        await this.cleanupGuest(failed);
      }
      throw new WorkerUnavailableError(
        error instanceof Error ? error.message : 'Browser worker recovery failed',
      );
    }
  }

  async reconcile(): Promise<void> {
    const activeSessions = this.#store.listActiveSessions();
    if (activeSessions.length === 0) {
      return;
    }

    if (!(await this.#workerDriver.isReady())) {
      this.#onMonitorError(
        new WorkerUnavailableError(
          'Browser worker driver is unavailable during startup reconciliation',
        ),
      );
      return;
    }

    for (const session of activeSessions) {
      try {
        if (session.status === 'stopping') {
          await this.stop(session.id);
          continue;
        }

        if (session.workerId) {
          const state = await this.#workerDriver.inspect(session.workerId);
          if (state === 'running' || state === 'starting') {
            this.#store.updateSession(session.id, {
              status: state,
              updatedAt: this.#now().toISOString(),
            });
            continue;
          }
        }

        await this.recover(session.id);
      } catch (error) {
        this.#onMonitorError(error);
      }
    }
  }

  async monitor(): Promise<void> {
    if (this.#monitoring) {
      return;
    }
    this.#monitoring = true;

    try {
      const cutoff = this.#now().getTime() - this.#idleTimeoutMilliseconds;
      for (const session of this.#store.listActiveSessions()) {
        try {
          if (session.status === 'stopping') {
            await this.stop(session.id);
            continue;
          }

          if (new Date(session.lastSeenAt).getTime() <= cutoff) {
            await this.stop(session.id);
            continue;
          }

          if (!session.workerId) {
            await this.recover(session.id);
            continue;
          }

          const state = await this.#workerDriver.inspect(session.workerId);
          if (state === 'running' && session.status !== 'running') {
            this.#store.updateSession(session.id, {
              status: 'running',
              updatedAt: this.#now().toISOString(),
            });
          } else if (
            state === 'missing' ||
            state === 'stopped' ||
            state === 'unhealthy'
          ) {
            await this.recover(session.id);
          }
        } catch (error) {
          this.#onMonitorError(error);
        }
      }
    } finally {
      this.#monitoring = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }

    await Promise.allSettled(
      this.#store.listActiveSessions().map(async (session) => {
        await this.stop(session.id);
      }),
    );
  }

  private async startWorker(
    session: StoredBrowserSession,
  ): Promise<StoredBrowserSession> {
    const { workerId } = await this.#workerDriver.start({
      kind: session.kind,
      sessionId: session.id,
      storagePath: session.storagePath,
    });
    const timestamp = this.#now().toISOString();

    return this.#store.updateSession(session.id, {
      status: 'starting',
      updatedAt: timestamp,
      workerId,
    });
  }

  private markFailed(id: string, reason: string): StoredBrowserSession {
    const timestamp = this.#now().toISOString();
    return this.#store.updateSession(id, {
      endedAt: timestamp,
      failureReason: reason,
      status: 'failed',
      updatedAt: timestamp,
      workerId: null,
    });
  }

  private async cleanupGuest(session: StoredBrowserSession): Promise<void> {
    const guestRoot = resolve(this.#paths.guests);
    const target = resolve(guestRoot, session.id);
    const relativeTarget = relative(guestRoot, target);

    if (
      !relativeTarget ||
      relativeTarget.startsWith('..') ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error('Guest cleanup path escaped the runtime guest directory');
    }

    await rm(target, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }

  private sessionFilesystemPath(session: StoredBrowserSession): string {
    return session.kind === 'profile' && session.profileId
      ? resolve(this.#paths.profiles, session.profileId, 'firefox')
      : resolve(this.#paths.guests, session.id, 'firefox');
  }
}
