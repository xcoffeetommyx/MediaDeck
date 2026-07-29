import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { DockerEngineClient } from './docker-engine.js';

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  }
});

it('times out a Docker Engine request that never responds', async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-docker-engine-'));
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\mediadeck-${randomUUID()}`
      : join(temporaryDirectory, 'docker.sock');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  try {
    const client = new DockerEngineClient(socketPath, 50);
    await expect(client.request({ path: '/_ping' })).rejects.toThrow(
      'Docker Engine did not respond within 50 ms',
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
