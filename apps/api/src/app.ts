import { access } from 'node:fs/promises';

import fastifyStatic from '@fastify/static';
import type { ServerConfig } from '@mediadeck/config';
import type {
  BrowserWorkerHealthResponse,
  HealthResponse,
  PublicConfigResponse,
} from '@mediadeck/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import {
  type BrowserTransportProbe,
  DriverBrowserTransportProbe,
  HttpBrowserTransportProbe,
} from './browser-transport.js';
import {
  createBrowserWorkerDriver,
  type BrowserWorkerDriver,
} from './browser-worker-driver.js';
import { DomainError } from './domain-errors.js';
import { ProfileManager } from './profile-manager.js';
import { registerProfileRoutes } from './profile-routes.js';
import { registerSessionRoutes } from './session-routes.js';
import { SessionManager } from './session-manager.js';
import { ensureStorageLayout } from './storage.js';
import { MediaDeckStore } from './store.js';

export type BuildApplicationOptions = {
  browserTransportProbe?: BrowserTransportProbe;
  config: ServerConfig;
  logger?: boolean;
  sessionManager?: SessionManager;
  store?: MediaDeckStore;
  workerDriver?: BrowserWorkerDriver;
};

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isClientHttpError(
  error: unknown,
): error is Error & { code?: string; statusCode: number } {
  if (!(error instanceof Error) || !('statusCode' in error)) {
    return false;
  }

  const statusCode = error.statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

export async function buildApplication({
  browserTransportProbe,
  config,
  logger,
  sessionManager: providedSessionManager,
  store: providedStore,
  workerDriver: providedWorkerDriver,
}: BuildApplicationOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
    },
    trustProxy: config.trustProxy,
  });

  const paths = await ensureStorageLayout(config.dataDirectory);
  const store = providedStore ?? new MediaDeckStore(paths.databaseFile);
  const workerDriver =
    providedWorkerDriver ?? createBrowserWorkerDriver(config.browserWorker);
  const profileManager = new ProfileManager(store, paths);
  const sessionManager =
    providedSessionManager ??
    new SessionManager({
      healthIntervalSeconds: config.browserWorker.healthIntervalSeconds,
      idleTimeoutSeconds: config.browserWorker.idleTimeoutSeconds,
      maxSessions: config.browserWorker.maxSessions,
      onMonitorError: (error) => {
        app.log.error(error, 'Browser session monitor failed');
      },
      paths,
      store,
      workerDriver,
    });

  await sessionManager.initialize();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        statusCode: error.statusCode,
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        issues: error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path,
        })),
        message: 'The request was invalid',
        statusCode: 400,
      });
    }

    if (isClientHttpError(error)) {
      return reply.code(error.statusCode).send({
        error: error.code ?? 'request_error',
        message: error.message,
        statusCode: error.statusCode,
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: 'internal_error',
      message: 'An unexpected error occurred',
      statusCode: 500,
    });
  });

  app.addHook('onClose', async () => {
    await sessionManager.shutdown();
    if (!providedStore) {
      store.close();
    }
  });

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

  const transportProbe =
    browserTransportProbe ??
    (config.browserWorker.driver === 'docker'
      ? new DriverBrowserTransportProbe(workerDriver)
      : new HttpBrowserTransportProbe({
          workerUrl: config.browserWorkerUrl,
        }));

  app.get(
    '/api/v1/browser-worker/health',
    async (): Promise<BrowserWorkerHealthResponse> => transportProbe.check(),
  );

  registerProfileRoutes(app, profileManager);
  registerSessionRoutes(app, sessionManager);

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
