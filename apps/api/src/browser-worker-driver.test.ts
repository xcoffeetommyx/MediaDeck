import type { BrowserWorkerConfig } from '@mediadeck/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { DockerBrowserWorkerDriver } from './browser-worker-driver.js';

const workerImage = 'mediadeck-brave-origin:0.1.0';

let temporaryDirectory: string | undefined;
let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  }
});

function workerConfig(socketPath: string): BrowserWorkerConfig {
  return {
    cpus: 2,
    dataVolumeName: 'mediadeck-data',
    dockerSocketPath: socketPath,
    driDevice: '/dev/dri/renderD128',
    driver: 'docker',
    framerate: 30,
    gpuMode: 'software',
    healthIntervalSeconds: 15,
    idleTimeoutSeconds: 1800,
    image: workerImage,
    maxSessions: 1,
    memoryMegabytes: 2048,
    network: 'mediadeck_default',
    pgid: 1000,
    pidsLimit: 512,
    puid: 1000,
    sharedMemoryMegabytes: 1024,
    startUrl: 'https://www.youtube.com/',
    timezone: 'Etc/UTC',
    videoBitrate: 6,
    vaapiDriver: 'auto',
  };
}

async function socketPath(): Promise<string> {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-worker-driver-'));
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\mediadeck-${randomUUID()}`
    : join(temporaryDirectory, 'docker.sock');
}

async function listen(nextServer: Server, path: string): Promise<void> {
  server = nextServer;
  await new Promise<void>((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(path, resolve);
  });
}

it('pulls a missing digest-pinned worker image once for concurrent starts', async () => {
  const path = await socketPath();
  const encodedImage = encodeURIComponent(workerImage);
  let imageAvailable = false;
  let pullRequests = 0;
  let workerSequence = 0;

  await listen(
    createServer((request, response) => {
      const requestPath = request.url ?? '';

      if (request.method === 'GET' && requestPath === `/images/${encodedImage}/json`) {
        response.statusCode = imageAvailable ? 200 : 404;
        response.end(imageAvailable ? '{}' : '{"message":"No such image"}');
        return;
      }

      if (
        request.method === 'POST' &&
        requestPath === `/images/create?fromImage=${encodedImage}`
      ) {
        pullRequests += 1;
        setTimeout(() => {
          imageAvailable = true;
          response.statusCode = 200;
          response.end('{"status":"Pull complete"}\n');
        }, 20);
        return;
      }

      if (request.method === 'DELETE' && requestPath.startsWith('/containers/')) {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === 'POST' && requestPath.startsWith('/containers/create?')) {
        workerSequence += 1;
        response.statusCode = 201;
        response.end(JSON.stringify({ Id: `worker-${workerSequence}` }));
        return;
      }

      if (
        request.method === 'POST' &&
        /^\/containers\/worker-\d+\/start$/.test(requestPath)
      ) {
        response.statusCode = 204;
        response.end();
        return;
      }

      response.statusCode = 500;
      response.end(JSON.stringify({ message: `Unexpected ${request.method} request` }));
    }),
    path,
  );

  const driver = new DockerBrowserWorkerDriver(workerConfig(path));
  const starts = await Promise.all(
    [
      '2abfc294-b100-48e1-93ad-bd34718e9a97',
      '51ba5929-24a0-4a09-925c-3f215a607e27',
    ].map((sessionId) =>
      driver.start({
        framerate: 30,
        kind: 'guest',
        launchUrl: 'https://www.youtube.com/',
        sessionId,
        storagePath: `runtime/guests/${sessionId}/brave-origin`,
        videoBitrate: 6,
      }),
    ),
  );

  expect(starts).toEqual([{ workerId: 'worker-1' }, { workerId: 'worker-2' }]);
  expect(pullRequests).toBe(1);
});

it('reports an error embedded in a Docker image pull stream', async () => {
  const path = await socketPath();
  const encodedImage = encodeURIComponent(workerImage);

  await listen(
    createServer((request, response) => {
      const requestPath = request.url ?? '';
      if (request.method === 'GET' && requestPath === `/images/${encodedImage}/json`) {
        response.statusCode = 404;
        response.end('{"message":"No such image"}');
        return;
      }
      if (
        request.method === 'POST' &&
        requestPath === `/images/create?fromImage=${encodedImage}`
      ) {
        response.statusCode = 200;
        response.end(
          '{"errorDetail":{"message":"registry denied the pull"},"error":"registry denied the pull"}\n',
        );
        return;
      }
      response.statusCode = 500;
      response.end();
    }),
    path,
  );

  const driver = new DockerBrowserWorkerDriver(workerConfig(path));
  await expect(
    driver.start({
      framerate: 30,
      kind: 'guest',
      launchUrl: 'https://www.youtube.com/',
      sessionId: '2abfc294-b100-48e1-93ad-bd34718e9a97',
      storagePath: 'runtime/guests/2abfc294-b100-48e1-93ad-bd34718e9a97/brave-origin',
      videoBitrate: 6,
    }),
  ).rejects.toThrow(
    'Docker Engine could not pull the browser worker image: registry denied the pull',
  );
});

it('uses DRI automatically and falls back to software when the device is unavailable', async () => {
  const path = await socketPath();
  const encodedImage = encodeURIComponent(workerImage);
  const createBodies: Record<string, unknown>[] = [];
  let createSequence = 0;

  await listen(
    createServer((request, response) => {
      const requestPath = request.url ?? '';

      if (request.method === 'GET' && requestPath === `/images/${encodedImage}/json`) {
        response.statusCode = 200;
        response.end('{}');
        return;
      }

      if (request.method === 'DELETE' && requestPath.startsWith('/containers/')) {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === 'POST' && requestPath.startsWith('/containers/create?')) {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          createBodies.push(
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
              string,
              unknown
            >,
          );
          createSequence += 1;
          response.statusCode = 201;
          response.end(
            JSON.stringify({
              Id: createSequence === 1 ? 'hardware-worker' : 'software-worker',
            }),
          );
        });
        return;
      }

      if (
        request.method === 'POST' &&
        requestPath === '/containers/hardware-worker/start'
      ) {
        response.statusCode = 500;
        response.end(
          JSON.stringify({
            message:
              'error gathering device information while adding custom device "/dev/dri/renderD128": no such file or directory',
          }),
        );
        return;
      }

      if (
        request.method === 'POST' &&
        requestPath === '/containers/software-worker/start'
      ) {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (
        request.method === 'POST' &&
        requestPath === '/containers/hardware-worker/stop?t=10'
      ) {
        response.statusCode = 204;
        response.end();
        return;
      }

      response.statusCode = 500;
      response.end(JSON.stringify({ message: `Unexpected ${request.method} request` }));
    }),
    path,
  );

  const config = workerConfig(path);
  config.gpuMode = 'auto';
  config.vaapiDriver = 'i965';
  const driver = new DockerBrowserWorkerDriver(config);
  await expect(
    driver.start({
      disableAv1Playback: true,
      framerate: 30,
      kind: 'guest',
      launchUrl: 'https://www.youtube.com/',
      policyStoragePath:
        'profiles/8417990e-73dd-4d70-894f-d1bc1425d7de/brave-origin/mediadeck/policy',
      sessionId: '2abfc294-b100-48e1-93ad-bd34718e9a97',
      storagePath: 'runtime/guests/2abfc294-b100-48e1-93ad-bd34718e9a97/brave-origin',
      videoBitrate: 6,
    }),
  ).resolves.toEqual({ workerId: 'software-worker' });

  const hardware = createBodies[0] as {
    Env: string[];
    HostConfig: {
      Devices?: unknown[];
      Mounts: {
        ReadOnly?: boolean;
        Target: string;
        VolumeOptions?: { Subpath?: string };
      }[];
    };
    Labels: Record<string, string>;
  };
  const software = createBodies[1] as {
    Env: string[];
    HostConfig: { Devices?: unknown[] };
    Labels: Record<string, string>;
  };
  expect(hardware.Env).toContain('AUTO_GPU=true');
  expect(hardware.Env).toContain('LIBVA_DRIVER_NAME=i965');
  expect(hardware.Env).toContain('LIBVA_DRIVERS_PATH=/usr/lib/x86_64-linux-gnu/dri');
  expect(hardware.Env).toContain(
    'BRAVE_CLI=--kiosk --no-first-run --disable-session-crashed-bubble --load-extension=/opt/mediadeck/extensions/disable-av1 https://www.youtube.com/',
  );
  expect(hardware.Env.some((value) => value.startsWith('FIREFOX_CLI='))).toBe(false);
  expect(hardware.Env).toContain('SELKIES_USE_CPU=false|locked');
  expect(hardware.HostConfig.Devices).toHaveLength(1);
  expect(hardware.HostConfig.Mounts).toContainEqual(
    expect.objectContaining({
      ReadOnly: true,
      Target: '/etc/brave/policies/managed',
      VolumeOptions: {
        Subpath:
          'profiles/8417990e-73dd-4d70-894f-d1bc1425d7de/brave-origin/mediadeck/policy',
      },
    }),
  );
  expect(hardware.Labels['io.mediadeck.gpu.mode']).toBe('dri');
  expect(software.Env).toContain('SELKIES_USE_CPU=true|locked');
  expect(software.HostConfig.Devices).toBeUndefined();
  expect(software.Labels['io.mediadeck.gpu.mode']).toBe('software');
});
