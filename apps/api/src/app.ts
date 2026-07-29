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

import { ApplicationRegistry } from './application-registry.js';
import { registerApplicationRoutes } from './application-routes.js';
import { AddonManager } from './addon-manager.js';
import { registerAddonRoutes } from './addon-routes.js';
import { AdministratorAccess } from './administrator-access.js';
import { applyScheduledRestore, BackupManager } from './backup-manager.js';
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
import { OperationsManager } from './operations.js';
import { registerOperationsRoutes } from './operations-routes.js';
import { OperationCoordinator } from './operation-coordinator.js';
import { ProfileManager } from './profile-manager.js';
import { registerProfileRoutes } from './profile-routes.js';
import { registerSessionRoutes } from './session-routes.js';
import { SessionManager } from './session-manager.js';
import { SettingsManager } from './settings-manager.js';
import { ensureStorageLayout } from './storage.js';
import { MediaDeckStore } from './store.js';
import { registerStreamGateway } from './stream-gateway.js';
import { UpdateManager } from './update-manager.js';

export type BuildApplicationOptions = {
  browserTransportProbe?: BrowserTransportProbe;
  config: ServerConfig;
  logger?: boolean;
  sessionManager?: SessionManager;
  store?: MediaDeckStore;
  updateFetch?: typeof fetch;
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
  updateFetch,
  workerDriver: providedWorkerDriver,
}: BuildApplicationOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
    },
    trustProxy: config.trustProxy,
  });

  const paths = await ensureStorageLayout(config.dataDirectory);
  const restoredBackupId = providedStore ? null : await applyScheduledRestore(paths);
  const store = providedStore ?? new MediaDeckStore(paths.databaseFile);
  const workerDriver =
    providedWorkerDriver ?? createBrowserWorkerDriver(config.browserWorker);
  const applications = new ApplicationRegistry(config.browserWorker.startUrl);
  const operationCoordinator = new OperationCoordinator();
  const addonManager = new AddonManager({
    config: config.addons,
    onError: (error) => {
      app.log.error(error, 'Firefox add-on watch scan failed');
    },
    operations: operationCoordinator,
    paths,
    store,
  });
  const profileManager = new ProfileManager(
    store,
    paths,
    undefined,
    operationCoordinator,
    (error) => {
      app.log.error(error, 'Profile event logging failed');
    },
  );
  const sessionManager =
    providedSessionManager ??
    new SessionManager({
      applications,
      healthIntervalSeconds: config.browserWorker.healthIntervalSeconds,
      idleTimeoutSeconds: config.browserWorker.idleTimeoutSeconds,
      maxSessions: config.browserWorker.maxSessions,
      onMonitorError: (error) => {
        app.log.error(error, 'Browser session monitor failed');
      },
      operations: operationCoordinator,
      paths,
      prepareProfileAddons: (profileId) => addonManager.prepareProfile(profileId),
      store,
      workerDriver,
      workerConfig: config.browserWorker,
    });
  let updates: UpdateManager | undefined;

  app.addHook('onClose', async () => {
    addonManager.close();
    updates?.close();
    await sessionManager.shutdown();
    if (!providedStore) {
      store.close();
    }
  });

  try {
    await addonManager.initialize();
    await sessionManager.initialize();

    if (restoredBackupId) {
      try {
        store.recordEvent(
          'backup',
          'warning',
          `Restore from backup ${restoredBackupId} completed during startup`,
        );
      } catch (error) {
        app.log.error(error, 'Restore event logging failed');
      }
    }

    const transportProbe =
      browserTransportProbe ??
      (config.browserWorker.driver === 'docker'
        ? new DriverBrowserTransportProbe(workerDriver)
        : new HttpBrowserTransportProbe({
            workerUrl: config.browserWorkerUrl,
          }));
    const administrator = new AdministratorAccess(store, undefined, (error) => {
      app.log.error(error, 'Administrator event logging failed');
    });
    const settings = new SettingsManager(store, undefined, (error) => {
      app.log.error(error, 'Settings event logging failed');
    });
    const backups = new BackupManager(
      config.appVersion,
      paths,
      store,
      () => settings.get().backupRetentionCount,
      undefined,
      operationCoordinator,
      (error) => {
        app.log.error(error, 'Backup housekeeping failed');
      },
    );
    updates = new UpdateManager({
      appVersion: config.appVersion,
      backups,
      ...(updateFetch ? { fetch: updateFetch } : {}),
      ...(config.updateManifestUrl ? { manifestUrl: config.updateManifestUrl } : {}),
      onError: (error) => {
        app.log.error(error, 'Update event logging failed');
      },
      paths,
      store,
    });
    const operations = new OperationsManager(
      config.appVersion,
      backups,
      paths,
      transportProbe,
      sessionManager,
      store,
      undefined,
      (error) => {
        app.log.error(error, 'Recovery event logging failed');
      },
    );
    updates.initialize(settings.get().automaticUpdateChecks);

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

    app.get(
      '/api/v1/browser-worker/health',
      async (): Promise<BrowserWorkerHealthResponse> => transportProbe.check(),
    );
    app.get('/api/v1/capacity', () => sessionManager.capacity());

    app.addContentTypeParser(
      ['application/x-xpinstall', 'application/octet-stream'],
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );

    registerProfileRoutes(app, profileManager, administrator);
    registerAddonRoutes(
      app,
      addonManager,
      administrator,
      config.addons.maxPackageBytes,
    );
    registerSessionRoutes(
      app,
      sessionManager,
      administrator,
      config.sessionCookieSecure,
    );
    registerApplicationRoutes(
      app,
      applications,
      sessionManager,
      config.sessionCookieSecure,
    );
    registerOperationsRoutes(app, {
      administrator,
      backups,
      operations,
      sessions: sessionManager,
      settings,
      updates,
    });
    registerStreamGateway(app, sessionManager);

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
  } catch (error) {
    await app.close().catch((shutdownError: unknown) => {
      app.log.error(shutdownError, 'Startup cleanup failed');
    });
    throw error;
  }
}
