import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getStoragePaths, type StoragePaths } from '@mediadeck/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  BrowserWorkerDriver,
  BrowserWorkerState,
  StartBrowserWorkerInput,
} from './browser-worker-driver.js';
import { ApplicationRegistry } from './application-registry.js';
import {
  CapacityError,
  ConflictError,
  WorkerUnavailableError,
} from './domain-errors.js';
import { ProfileManager } from './profile-manager.js';
import { SessionManager } from './session-manager.js';
import { ensureStorageLayout } from './storage.js';
import { MediaDeckStore } from './store.js';

class FakeBrowserWorkerDriver implements BrowserWorkerDriver {
  failStops = false;
  readonly starts: StartBrowserWorkerInput[] = [];
  readonly states = new Map<string, BrowserWorkerState>();

  getStreamTarget(sessionId: string): URL {
    return new URL(`http://worker-${sessionId}:3000`);
  }

  inspect(workerId: string): Promise<BrowserWorkerState> {
    return Promise.resolve(this.states.get(workerId) ?? 'missing');
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(true);
  }

  metrics() {
    return Promise.resolve({
      cpuPercent: 12.5,
      memoryBytes: 256 * 1024 * 1024,
      memoryLimitBytes: 2048 * 1024 * 1024,
      networkReceiveBytes: 1024,
      networkTransmitBytes: 2048,
      pids: 42,
    });
  }

  start(input: StartBrowserWorkerInput): Promise<{ workerId: string }> {
    this.starts.push(input);
    const workerId = `worker-${this.starts.length}`;
    this.states.set(workerId, 'running');
    return Promise.resolve({ workerId });
  }

  stop(workerId: string): Promise<void> {
    if (this.failStops) {
      return Promise.reject(new Error('Docker unavailable'));
    }
    this.states.delete(workerId);
    return Promise.resolve();
  }
}

let dataDirectory: string;
let driver: FakeBrowserWorkerDriver;
let paths: StoragePaths;
let profiles: ProfileManager;
let store: MediaDeckStore;
let now: Date;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-sessions-'));
  paths = await ensureStorageLayout(dataDirectory);
  store = new MediaDeckStore(paths.databaseFile);
  profiles = new ProfileManager(store, paths);
  driver = new FakeBrowserWorkerDriver();
  now = new Date('2026-07-28T12:00:00.000Z');
});

afterEach(async () => {
  store.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

function createManager(maxSessions = 1): SessionManager {
  return new SessionManager({
    applications: new ApplicationRegistry('https://www.youtube.com/'),
    healthIntervalSeconds: 300,
    idleTimeoutSeconds: 1800,
    maxSessions,
    now: () => now,
    paths,
    store,
    workerDriver: driver,
    workerConfig: {
      cpus: 2,
      dataVolumeName: 'mediadeck-test',
      dockerSocketPath: '/var/run/docker.sock',
      driver: 'docker',
      driDevice: '/dev/dri/renderD128',
      framerate: 60,
      gpuMode: 'software',
      healthIntervalSeconds: 300,
      idleTimeoutSeconds: 1800,
      image: 'test-image',
      maxSessions,
      memoryMegabytes: 2048,
      network: 'test-network',
      pgid: 1000,
      pidsLimit: 512,
      puid: 1000,
      sharedMemoryMegabytes: 1024,
      startUrl: 'https://www.youtube.com/',
      timezone: 'Etc/UTC',
      videoBitrate: 12,
    },
  });
}

describe('session manager', () => {
  it('locks one persistent profile while allowing a future multi-profile limit', async () => {
    const firstProfile = await profiles.create({ name: 'First' });
    const secondProfile = await profiles.create({ name: 'Second' });
    const sessions = createManager(2);

    const first = await sessions.start({
      kind: 'profile',
      profileId: firstProfile.id,
    });

    await expect(
      sessions.start({
        kind: 'profile',
        profileId: firstProfile.id,
      }),
    ).rejects.toThrow(ConflictError);

    const second = await sessions.start({
      kind: 'profile',
      profileId: secondProfile.id,
    });

    expect(first.profileId).toBe(firstProfile.id);
    expect(second.profileId).toBe(secondProfile.id);
    expect(driver.starts).toHaveLength(2);

    await sessions.shutdown();
  });

  it('enforces the configured host capacity independently of profile locking', async () => {
    const profile = await profiles.create({ name: 'Only' });
    const sessions = createManager(1);
    await sessions.start({ kind: 'profile', profileId: profile.id });

    await expect(sessions.start({ kind: 'guest' })).rejects.toThrow(CapacityError);

    await sessions.shutdown();
  });

  it('recovers one failed worker without interrupting another active profile', async () => {
    const firstProfile = await profiles.create({ name: 'First isolated' });
    const secondProfile = await profiles.create({ name: 'Second isolated' });
    const sessions = createManager(2);
    const first = await sessions.start({
      kind: 'profile',
      profileId: firstProfile.id,
    });
    const second = await sessions.start({
      kind: 'profile',
      profileId: secondProfile.id,
    });
    const firstWorker = store.requireSession(first.id).workerId!;
    const secondWorker = store.requireSession(second.id).workerId!;

    driver.states.delete(firstWorker);
    await sessions.heartbeat(first.id);

    expect(store.requireSession(first.id).workerId).not.toBe(firstWorker);
    expect(store.requireSession(second.id).workerId).toBe(secondWorker);
    expect(driver.states.get(secondWorker)).toBe('running');
    expect(sessions.get(second.id).status).toBe('starting');

    await sessions.shutdown();
  });

  it('reports capacity, configured ceilings, and per-worker usage', async () => {
    const sessions = createManager(2);
    const guest = await sessions.start({ kind: 'guest' });
    const report = await sessions.resources();

    expect(sessions.capacity()).toMatchObject({
      activeSessions: 1,
      availableSlots: 1,
      atCapacity: false,
      maxSessions: 2,
    });
    expect(report.limitsPerWorker).toMatchObject({
      cpus: 2,
      memoryBytes: 2048 * 1024 * 1024,
      pids: 512,
      videoBitrateMbps: 12,
    });
    expect(report.sessions).toEqual([
      expect.objectContaining({
        cpuPercent: 12.5,
        sessionId: guest.id,
      }),
    ]);

    await sessions.shutdown();
  });

  it('deletes Guest storage when its session stops', async () => {
    const sessions = createManager();
    const guest = await sessions.start({ kind: 'guest' });
    const guestPath = join(paths.guests, guest.id);

    await expect(access(guestPath)).resolves.toBeUndefined();
    await expect(sessions.stop(guest.id)).resolves.toMatchObject({
      kind: 'guest',
      status: 'stopped',
    });
    await expect(access(guestPath)).rejects.toThrow();
  });

  it('recovers a crashed worker without replacing persistent profile data', async () => {
    const profile = await profiles.create({ name: 'Recovery' });
    const sessions = createManager();
    const session = await sessions.start({
      kind: 'profile',
      profileId: profile.id,
    });
    const marker = join(paths.profiles, profile.id, 'firefox', 'marker.txt');
    await writeFile(marker, 'persistent');

    driver.states.clear();
    now = new Date('2026-07-28T12:01:00.000Z');
    const recovered = await sessions.heartbeat(session.id);

    expect(recovered).toMatchObject({
      id: session.id,
      lastSeenAt: now.toISOString(),
      profileId: profile.id,
      status: 'starting',
    });
    expect(driver.starts).toHaveLength(2);
    expect(driver.starts[1]?.storagePath).toBe(`profiles/${profile.id}/firefox`);
    await expect(access(marker)).resolves.toBeUndefined();

    await sessions.shutdown();
  });

  it('stops idle sessions using last-seen timestamps', async () => {
    const sessions = createManager();
    const guest = await sessions.start({ kind: 'guest' });
    now = new Date('2026-07-28T12:31:00.000Z');

    await sessions.monitor();

    expect(sessions.get(guest.id).status).toBe('stopped');
  });

  it('promotes a starting worker after a successful heartbeat', async () => {
    const profile = await profiles.create({ name: 'Heartbeat' });
    const sessions = createManager();
    const session = await sessions.start({
      kind: 'profile',
      profileId: profile.id,
    });

    now = new Date('2026-07-28T12:01:00.000Z');
    const refreshed = await sessions.heartbeat(session.id);

    expect(refreshed.status).toBe('running');
    expect(refreshed.lastSeenAt).toBe(now.toISOString());

    await sessions.shutdown();
  });

  it('finishes an interrupted stop during startup reconciliation', async () => {
    const sessions = createManager();
    const guest = await sessions.start({ kind: 'guest' });
    store.updateSession(guest.id, {
      status: 'stopping',
      updatedAt: now.toISOString(),
    });

    await sessions.reconcile();

    expect(sessions.get(guest.id).status).toBe('stopped');
    await expect(access(join(paths.guests, guest.id))).rejects.toThrow();
  });

  it('retains the lock and Guest data until a failed stop can be retried', async () => {
    const sessions = createManager();
    const guest = await sessions.start({ kind: 'guest' });
    driver.failStops = true;

    await expect(sessions.stop(guest.id)).rejects.toThrow(WorkerUnavailableError);
    expect(sessions.get(guest.id)).toMatchObject({
      status: 'stopping',
    });
    await expect(access(join(paths.guests, guest.id))).resolves.toBeUndefined();
    await expect(sessions.start({ kind: 'guest' })).rejects.toThrow(CapacityError);

    driver.failStops = false;
    await sessions.reconcile();
    expect(sessions.get(guest.id).status).toBe('stopped');
    await expect(access(join(paths.guests, guest.id))).rejects.toThrow();
  });

  it('uses the documented storage paths beneath the shared data volume', () => {
    const configured = getStoragePaths(dataDirectory);
    expect(configured.databaseFile).toBe(paths.databaseFile);
    expect(configured.guests).toBe(paths.guests);
  });

  it('launches YouTube idempotently and keeps the stream route opaque', async () => {
    const profile = await profiles.create({ name: 'Viewer' });
    const sessions = createManager();
    const sessionId = '2abfc294-b100-48e1-93ad-bd34718e9a97';

    const launched = await sessions.launch('youtube', {
      accessToken: 'a'.repeat(43),
      kind: 'profile',
      profileId: profile.id,
      sessionId,
    });
    const resumed = await sessions.launch('youtube', {
      accessToken: 'a'.repeat(43),
      kind: 'profile',
      profileId: profile.id,
      sessionId,
    });

    expect(launched).toMatchObject({
      applicationId: 'youtube',
      id: sessionId,
      streamUrl: `/stream/${sessionId}/`,
    });
    expect(resumed.id).toBe(sessionId);
    expect(driver.starts).toHaveLength(1);
    expect(driver.starts[0]).toMatchObject({
      launchUrl: 'https://www.youtube.com/',
      sessionId,
    });
    expect(sessions.getStreamTarget(sessionId).href).toBe(
      `http://worker-${sessionId}:3000/`,
    );

    await sessions.shutdown();
  });

  it('does not allow one session token to authorize another session', async () => {
    const sessions = createManager(2);
    const first = await sessions.start({
      accessToken: 'a'.repeat(43),
      kind: 'guest',
    });
    const second = await sessions.start({
      accessToken: 'b'.repeat(43),
      kind: 'guest',
    });

    expect(() => sessions.authorize(first.id, 'a'.repeat(43))).not.toThrow();
    expect(() => sessions.authorize(second.id, 'a'.repeat(43))).toThrow(
      'Valid authorization',
    );

    await sessions.shutdown();
  });
});
