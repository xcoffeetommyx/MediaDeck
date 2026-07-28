import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerConfig } from '@mediadeck/config';
import {
  browserSessionSchema,
  browserWorkerHealthResponseSchema,
  healthResponseSchema,
  profileSchema,
  publicConfigResponseSchema,
} from '@mediadeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApplication } from './app.js';
import type {
  BrowserWorkerDriver,
  StartBrowserWorkerInput,
} from './browser-worker-driver.js';

let dataDirectory: string;

class TestBrowserWorkerDriver implements BrowserWorkerDriver {
  inspect(): Promise<'running'> {
    return Promise.resolve('running');
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(true);
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
    dataVolumeName: 'mediadeck-test',
    dockerSocketPath: '/var/run/docker.sock',
    driver: 'disabled',
    framerate: 60,
    healthIntervalSeconds: 15,
    idleTimeoutSeconds: 1800,
    image: 'test-image',
    maxSessions,
    network: 'test-network',
    pgid: 1000,
    puid: 1000,
    startUrl: 'https://www.youtube.com/',
    timezone: 'Etc/UTC',
    videoBitrate: 12,
  },
  dataDirectory,
  host: '127.0.0.1',
  logLevel: 'silent',
  nodeEnvironment: 'test',
  port: 3000,
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

    const duplicateResponse = await app.inject({
      method: 'POST',
      payload: {
        kind: 'profile',
        profileId: profile.id,
      },
      url: '/api/v1/sessions',
    });
    expect(duplicateResponse.statusCode).toBe(409);

    const stoppedResponse = await app.inject({
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
});
