import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerConfig } from '@mediadeck/config';
import {
  backupSummarySchema,
  browserResourceReportSchema,
  browserSessionSchema,
  browserWorkerHealthResponseSchema,
  healthResponseSchema,
  operationEventListResponseSchema,
  profileSchema,
  publicConfigResponseSchema,
  sessionCapacitySchema,
  unlockAdministratorResponseSchema,
  updateStatusSchema,
} from '@mediadeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApplication } from './app.js';
import type {
  BrowserWorkerDriver,
  StartBrowserWorkerInput,
} from './browser-worker-driver.js';

let dataDirectory: string;

class TestBrowserWorkerDriver implements BrowserWorkerDriver {
  getStreamTarget(sessionId: string): URL {
    return new URL(`http://worker-${sessionId}:3000`);
  }

  inspect(): Promise<'running'> {
    return Promise.resolve('running');
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(true);
  }

  metrics() {
    return Promise.resolve({
      cpuPercent: 10,
      memoryBytes: 512 * 1024 * 1024,
      memoryLimitBytes: 2048 * 1024 * 1024,
      networkReceiveBytes: 1000,
      networkTransmitBytes: 2000,
      pids: 30,
    });
  }

  start({ sessionId }: StartBrowserWorkerInput): Promise<{ workerId: string }> {
    return Promise.resolve({ workerId: `worker-${sessionId}` });
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

const createConfig = (maxSessions = 1): ServerConfig => ({
  appVersion: '0.1.0-test',
  browserWorker: {
    cpus: 2,
    dataVolumeName: 'mediadeck-test',
    driDevice: '/dev/dri/renderD128',
    dockerSocketPath: '/var/run/docker.sock',
    driver: 'disabled',
    framerate: 60,
    gpuMode: 'software',
    healthIntervalSeconds: 15,
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
  dataDirectory,
  host: '127.0.0.1',
  logLevel: 'silent',
  nodeEnvironment: 'test',
  port: 3000,
  sessionCookieSecure: false,
  trustProxy: false,
});

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-api-'));
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe('MediaDeck API', () => {
  it('reports a valid health response', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toMatchObject({
      service: 'mediadeck-api',
      status: 'ok',
      version: '0.1.0-test',
    });
  });

  it('exposes only public configuration', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/config',
    });
    await app.close();

    expect(publicConfigResponseSchema.parse(response.json())).toEqual({
      appName: 'MediaDeck',
      environment: 'test',
      version: '0.1.0-test',
    });
    expect(response.body).not.toContain(dataDirectory);
  });

  it('returns a structured 404 for unknown API routes', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/missing',
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('exposes browser transport health through its neutral contract', async () => {
    const app = await buildApplication({
      browserTransportProbe: {
        check: () =>
          Promise.resolve({
            capabilities: {
              audio: true,
              gamepad: true,
              keyboard: true,
              pointer: true,
              reconnect: true,
              touch: true,
            },
            checkedAt: '2026-07-28T12:00:00.000Z',
            status: 'online',
            transport: {
              mode: 'websocket',
              provider: 'selkies',
            },
          }),
      },
      config: createConfig(),
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/browser-worker/health',
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(browserWorkerHealthResponseSchema.parse(response.json())).toMatchObject({
      status: 'online',
      transport: {
        mode: 'websocket',
        provider: 'selkies',
      },
    });
  });

  it('provides profile and opaque browser session lifecycle APIs', async () => {
    const app = await buildApplication({
      config: createConfig(2),
      logger: false,
      workerDriver: new TestBrowserWorkerDriver(),
    });

    const createdProfileResponse = await app.inject({
      method: 'POST',
      payload: {
        avatarId: 'blue-fox',
        name: 'Family',
      },
      url: '/api/v1/profiles',
    });
    const profile = profileSchema.parse(createdProfileResponse.json());

    const createdSessionResponse = await app.inject({
      method: 'POST',
      payload: {
        accessToken: 'a'.repeat(43),
        kind: 'profile',
        profileId: profile.id,
      },
      url: '/api/v1/sessions',
    });
    const session = browserSessionSchema.parse(createdSessionResponse.json());

    expect(createdProfileResponse.statusCode).toBe(201);
    expect(createdSessionResponse.statusCode).toBe(201);
    expect(session).toMatchObject({
      kind: 'profile',
      profileId: profile.id,
      status: 'starting',
    });
    expect(createdSessionResponse.body).not.toContain('worker-');
    expect(createdSessionResponse.body).not.toContain('storagePath');

    const capacity = sessionCapacitySchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/capacity',
        })
      ).json(),
    );
    expect(capacity).toMatchObject({
      activeSessions: 1,
      availableSlots: 1,
      maxSessions: 2,
    });

    const unauthorizedHeartbeat = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${session.id}/heartbeat`,
    });
    expect(unauthorizedHeartbeat.statusCode).toBe(401);

    const resources = browserResourceReportSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/operations/resources',
        })
      ).json(),
    );
    expect(resources.sessions[0]).toMatchObject({
      memoryBytes: 512 * 1024 * 1024,
      sessionId: session.id,
    });

    const duplicateResponse = await app.inject({
      method: 'POST',
      payload: {
        accessToken: 'a'.repeat(43),
        kind: 'profile',
        profileId: profile.id,
      },
      url: '/api/v1/sessions',
    });
    expect(duplicateResponse.statusCode).toBe(409);

    const stoppedResponse = await app.inject({
      headers: { 'x-mediadeck-session-token': 'a'.repeat(43) },
      method: 'POST',
      url: `/api/v1/sessions/${session.id}/stop`,
    });
    expect(browserSessionSchema.parse(stoppedResponse.json()).status).toBe('stopped');

    const deletedResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profiles/${profile.id}`,
    });
    expect(deletedResponse.statusCode).toBe(204);

    await app.close();
  });

  it('publishes the YouTube application and launches it idempotently', async () => {
    const driver = new TestBrowserWorkerDriver();
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
      workerDriver: driver,
    });

    const applicationsResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/applications',
    });
    expect(applicationsResponse.json()).toEqual({
      applications: [
        {
          available: true,
          description:
            'Subscriptions, playlists, recommendations, and playback in isolated Firefox.',
          displayName: 'YouTube',
          id: 'youtube',
        },
      ],
    });

    const sessionId = '2abfc294-b100-48e1-93ad-bd34718e9a97';
    const firstLaunch = await app.inject({
      method: 'POST',
      payload: { accessToken: 'b'.repeat(43), kind: 'guest', sessionId },
      url: '/api/v1/applications/youtube/launch',
    });
    const secondLaunch = await app.inject({
      method: 'POST',
      payload: { accessToken: 'b'.repeat(43), kind: 'guest', sessionId },
      url: '/api/v1/applications/youtube/launch',
    });

    expect(browserSessionSchema.parse(firstLaunch.json())).toMatchObject({
      applicationId: 'youtube',
      id: sessionId,
      streamUrl: `/stream/${sessionId}/`,
    });
    expect(browserSessionSchema.parse(secondLaunch.json()).id).toBe(sessionId);

    await app.close();
  });

  it('marks stream authorization cookies Secure in the production topology', async () => {
    const app = await buildApplication({
      config: {
        ...createConfig(),
        sessionCookieSecure: true,
      },
      logger: false,
      workerDriver: new TestBrowserWorkerDriver(),
    });

    const response = await app.inject({
      method: 'POST',
      payload: {
        accessToken: 's'.repeat(43),
        kind: 'guest',
        sessionId: '51ba5929-24a0-4a09-925c-3f215a607e27',
      },
      url: '/api/v1/applications/youtube/launch',
    });

    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(response.headers['set-cookie']).toContain('Secure');

    await app.close();
  });

  it('returns structured validation errors for malformed profile input', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      payload: {
        name: ' ',
      },
      url: '/api/v1/profiles',
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      statusCode: 400,
    });
  });

  it('protects privileged operations after an administrator PIN is enabled', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
    });

    const enabled = await app.inject({
      method: 'PUT',
      payload: { pin: '2468' },
      url: '/api/v1/admin/pin',
    });
    expect(enabled.json()).toMatchObject({
      authenticated: false,
      pinEnabled: true,
    });

    const unauthorized = await app.inject({
      method: 'PATCH',
      payload: { backupRetentionCount: 7 },
      url: '/api/v1/settings',
    });
    expect(unauthorized.statusCode).toBe(401);

    const wrongPin = await app.inject({
      method: 'POST',
      payload: { pin: '1111' },
      url: '/api/v1/admin/unlock',
    });
    expect(wrongPin.statusCode).toBe(401);

    const unlocked = await app.inject({
      method: 'POST',
      payload: { pin: '2468' },
      url: '/api/v1/admin/unlock',
    });
    const token = unlockAdministratorResponseSchema.parse(unlocked.json()).token;
    expect(token).toHaveLength(43);

    const updated = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'PATCH',
      payload: { backupRetentionCount: 7 },
      url: '/api/v1/settings',
    });
    expect(updated.json()).toMatchObject({ backupRetentionCount: 7 });

    const logs = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/api/v1/operations/logs',
    });
    expect(logs.statusCode).toBe(200);
    expect(
      operationEventListResponseSchema
        .parse(logs.json())
        .events.some((event) => event.category === 'administration'),
    ).toBe(true);

    await app.close();
  });

  it('creates a consistent backup and applies a scheduled restore on restart', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
    });
    await app.inject({
      method: 'POST',
      payload: { name: 'Before backup' },
      url: '/api/v1/profiles',
    });
    const createdBackup = await app.inject({
      method: 'POST',
      url: '/api/v1/backups',
    });
    const backup = backupSummarySchema.parse(createdBackup.json());
    expect(createdBackup.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      payload: { name: 'After backup' },
      url: '/api/v1/profiles',
    });
    const scheduled = await app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backup.id}/restore`,
    });
    expect(scheduled.json()).toMatchObject({
      backupId: backup.id,
      restartRequired: true,
    });
    await app.close();

    const restoredApp = await buildApplication({
      config: createConfig(),
      logger: false,
    });
    const restoredProfiles = await restoredApp.inject({
      method: 'GET',
      url: '/api/v1/profiles',
    });
    expect(restoredProfiles.json()).toMatchObject({
      profiles: [expect.objectContaining({ name: 'Before backup' })],
    });
    await restoredApp.close();
  });

  it('checks and approves only a digest-pinned update with a backup', async () => {
    const config = {
      ...createConfig(),
      updateManifestUrl: 'https://updates.example.test/stable.json',
    };
    const image = `ghcr.io/example/mediadeck@sha256:${'b'.repeat(64)}`;
    const app = await buildApplication({
      config,
      logger: false,
      updateFetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              image,
              publishedAt: '2026-07-28T12:00:00.000Z',
              releaseNotesUrl: 'https://updates.example.test/releases/0.2.0',
              schemaVersion: 1,
              version: '0.2.0',
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            },
          ),
        ),
    });

    const checked = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/check',
    });
    expect(updateStatusSchema.parse(checked.json())).toMatchObject({
      release: { image, version: '0.2.0' },
      state: 'available',
    });

    const approved = await app.inject({
      method: 'POST',
      payload: { version: '0.2.0' },
      url: '/api/v1/updates/approve',
    });
    const approvedStatus = updateStatusSchema.parse(approved.json());
    expect(approvedStatus.state).toBe('approved');
    expect(typeof approvedStatus.backupId).toBe('string');
    const approvedPlan: unknown = JSON.parse(
      await readFile(join(dataDirectory, 'runtime', 'approved-update.json'), 'utf8'),
    );
    expect(approvedPlan).toMatchObject({
      image,
      version: '0.2.0',
    });

    await app.close();
  });

  it('reports update-check failures without losing API availability', async () => {
    const app = await buildApplication({
      config: {
        ...createConfig(),
        updateManifestUrl: 'https://updates.example.test/stable.json',
      },
      logger: false,
      updateFetch: () => Promise.reject(new Error('release service offline')),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/check',
    });
    const failedStatus = updateStatusSchema.parse(response.json());
    expect(failedStatus.state).toBe('error');
    expect(failedStatus.message).toContain('release service offline');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/health',
        })
      ).statusCode,
    ).toBe(200);

    await app.close();
  });
});
