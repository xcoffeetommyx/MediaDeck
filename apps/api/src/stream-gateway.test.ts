import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerConfig } from '@mediadeck/config';
import { browserSessionSchema } from '@mediadeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApplication } from './app.js';
import type { BrowserWorkerDriver } from './browser-worker-driver.js';

class GatewayWorkerDriver implements BrowserWorkerDriver {
  constructor(private readonly target: URL) {}

  getStreamTarget(): URL {
    return this.target;
  }

  inspect(): Promise<'running'> {
    return Promise.resolve('running');
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(true);
  }

  metrics() {
    return Promise.resolve({
      cpuPercent: 0,
      memoryBytes: 0,
      memoryLimitBytes: 0,
      networkReceiveBytes: 0,
      networkTransmitBytes: 0,
      pids: 0,
    });
  }

  start(): Promise<{ workerId: string }> {
    return Promise.resolve({ workerId: 'gateway-worker' });
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

let dataDirectory: string;
let upstream: Server;
let upstreamUrl: URL;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-gateway-'));
  upstream = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(`proxied:${request.url}`);
  });
  upstream.on('upgrade', (request, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    );
    socket.end(`upgraded:${request.url}`);
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const address = upstream.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test upstream did not bind a TCP port');
  }
  upstreamUrl = new URL(`http://127.0.0.1:${address.port}`);
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    upstream.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(dataDirectory, { force: true, recursive: true });
});

function createConfig(): ServerConfig {
  return {
    appVersion: '0.1.0-test',
    browserWorker: {
      cpus: 2,
      dataVolumeName: 'mediadeck-test',
      driDevice: '/dev/dri/renderD128',
      dockerSocketPath: '/var/run/docker.sock',
      driver: 'disabled',
      framerate: 60,
      gpuMode: 'software',
      healthIntervalSeconds: 300,
      idleTimeoutSeconds: 1800,
      image: 'test-image',
      maxSessions: 1,
      memoryMegabytes: 2048,
      network: 'test-network',
      pgid: 1000,
      pidsLimit: 512,
      puid: 1000,
      sharedMemoryMegabytes: 1024,
      startUrl: 'https://www.youtube.com/',
      timezone: 'Etc/UTC',
      videoBitrate: 12,
      vaapiDriver: 'auto',
    },
    dataDirectory,
    host: '127.0.0.1',
    logLevel: 'silent',
    nodeEnvironment: 'test',
    port: 3000,
    sessionCookieSecure: false,
    trustProxy: false,
  };
}

describe('session stream gateway', () => {
  it('proxies HTTP and WebSocket traffic through the opaque session path', async () => {
    const app = await buildApplication({
      config: createConfig(),
      logger: false,
      workerDriver: new GatewayWorkerDriver(upstreamUrl),
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const sessionId = '2abfc294-b100-48e1-93ad-bd34718e9a97';
    const launchResponse = await app.inject({
      method: 'POST',
      payload: {
        accessToken: 'a'.repeat(43),
        kind: 'guest',
        sessionId,
      },
      url: '/api/v1/applications/youtube/launch',
    });
    const session = browserSessionSchema.parse(launchResponse.json());
    const cookie = launchResponse.headers['set-cookie'];
    if (typeof cookie !== 'string') {
      throw new Error('Launch did not issue a stream access cookie');
    }

    const unauthorizedResponse = await fetch(
      `${address}${session.streamUrl}assets/client.js`,
    );
    expect(unauthorizedResponse.status).toBe(401);

    const httpResponse = await fetch(`${address}${session.streamUrl}assets/client.js`, {
      headers: { cookie: cookie.split(';', 1)[0]! },
    });
    expect(await httpResponse.text()).toBe(
      `proxied:${session.streamUrl}assets/client.js`,
    );

    const applicationAddress = app.server.address();
    if (!applicationAddress || typeof applicationAddress === 'string') {
      throw new Error('Test application did not bind a TCP port');
    }
    const upgradeResponse = await new Promise<string>((resolve, reject) => {
      const socket = connect(applicationAddress.port, '127.0.0.1');
      let received = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.write(
          `GET ${session.streamUrl}websockets HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: ${cookie.split(';', 1)[0]!}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      socket.on('data', (chunk: string) => {
        received += chunk;
      });
      socket.on('end', () => resolve(received));
      socket.on('error', reject);
    });

    expect(upgradeResponse).toContain('101 Switching Protocols');
    expect(upgradeResponse).toContain(`upgraded:${session.streamUrl}websockets`);

    await app.close();
  });
});
