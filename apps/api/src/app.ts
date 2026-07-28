import { access } from 'node:fs/promises';

import fastifyStatic from '@fastify/static';
import type { ServerConfig } from '@mediadeck/config';
import type { HealthResponse, PublicConfigResponse } from '@mediadeck/contracts';
import Fastify, { type FastifyInstance } from 'fastify';

import { ensureStorageLayout } from './storage.js';

export type BuildApplicationOptions = {
  config: ServerConfig;
  logger?: boolean;
};

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildApplication({
  config,
  logger,
}: BuildApplicationOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
    },
    trustProxy: config.trustProxy,
  });

  await ensureStorageLayout(config.dataDirectory);

  const createHealthResponse = (): HealthResponse => ({
    service: 'mediadeck-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    version: config.appVersion,
  });

  app.get('/healthz', () => createHealthResponse());
  app.get('/api/v1/health', () => createHealthResponse());

  app.get('/api/v1/config', (): PublicConfigResponse => {
    return {
      appName: 'MediaDeck',
      environment: config.nodeEnvironment,
      version: config.appVersion,
    };
  });

  if (config.publicDirectory && (await directoryExists(config.publicDirectory))) {
    await app.register(fastifyStatic, {
      root: config.publicDirectory,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        request.headers.accept?.includes('text/html')
      ) {
        return reply.sendFile('index.html');
      }

      return reply.code(404).send({
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
        statusCode: 404,
      });
    });
  }

  return app;
}
