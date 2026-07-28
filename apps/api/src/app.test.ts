import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerConfig } from '@mediadeck/config';
import { healthResponseSchema, publicConfigResponseSchema } from '@mediadeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApplication } from './app.js';

let dataDirectory: string;

const createConfig = (): ServerConfig => ({
  appVersion: '0.1.0-test',
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
});
