import type { BrowserWorkerConfig } from '@mediadeck/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { DockerBrowserWorkerDriver } from './browser-worker-driver.js';

const workerImage =
  'ghcr.io/linuxserver/firefox@sha256:e4b9310d76fbaef54de9b6a440113729c442125f50668ad9e9f678c0af1ae700';

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
        kind: 'guest',
        launchUrl: 'https://www.youtube.com/',
        sessionId,
        storagePath: `runtime/guests/${sessionId}/firefox`,
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
      kind: 'guest',
      launchUrl: 'https://www.youtube.com/',
      sessionId: '2abfc294-b100-48e1-93ad-bd34718e9a97',
      storagePath: 'runtime/guests/2abfc294-b100-48e1-93ad-bd34718e9a97/firefox',
    }),
  ).rejects.toThrow(
    'Docker Engine could not pull the browser worker image: registry denied the pull',
  );
});
