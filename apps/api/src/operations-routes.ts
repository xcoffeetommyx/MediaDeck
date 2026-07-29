import {
  approveUpdateRequestSchema,
  setAdministratorPinRequestSchema,
  unlockAdministratorRequestSchema,
  updateAdministratorSettingsRequestSchema,
} from '@mediadeck/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AdministratorAccess } from './administrator-access.js';
import type { BackupManager } from './backup-manager.js';
import type { OperationsManager } from './operations.js';
import type { SettingsManager } from './settings-manager.js';
import type { SessionManager } from './session-manager.js';
import type { UpdateManager } from './update-manager.js';

const backupParametersSchema = z.object({
  backupId: z.string().regex(/^[a-zA-Z0-9._-]{1,96}$/),
});

const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

function authorization(request: FastifyRequest): string | undefined {
  return request.headers.authorization;
}

export function registerOperationsRoutes(
  app: FastifyInstance,
  dependencies: {
    administrator: AdministratorAccess;
    backups: BackupManager;
    operations: OperationsManager;
    sessions: SessionManager;
    settings: SettingsManager;
    updates: UpdateManager;
  },
): void {
  const { administrator, backups, operations, sessions, settings, updates } =
    dependencies;

  app.get('/api/v1/admin/status', (request) =>
    administrator.getStatus(authorization(request)),
  );

  app.post('/api/v1/admin/unlock', (request) => {
    const input = unlockAdministratorRequestSchema.parse(request.body);
    return administrator.unlock(input.pin, request.ip);
  });

  app.post('/api/v1/admin/lock', (request) =>
    administrator.lock(authorization(request)),
  );

  app.put('/api/v1/admin/pin', (request) => {
    const input = setAdministratorPinRequestSchema.parse(request.body);
    return administrator.setPin(input.pin, authorization(request));
  });

  app.get('/api/v1/settings', () => settings.get());

  app.patch('/api/v1/settings', (request) => {
    administrator.require(authorization(request));
    const input = updateAdministratorSettingsRequestSchema.parse(request.body);
    const updated = settings.update(input);
    updates.setAutomaticChecks(updated.automaticUpdateChecks);
    return updated;
  });

  app.get('/api/v1/operations/diagnostics', () => operations.diagnostics());

  app.get('/api/v1/operations/logs', (request) => {
    administrator.require(authorization(request));
    const { limit } = logQuerySchema.parse(request.query);
    return operations.logs(limit);
  });

  app.get('/api/v1/operations/resources', (request) => {
    administrator.require(authorization(request));
    return sessions.resources();
  });

  app.post('/api/v1/operations/reconcile', (request) => {
    administrator.require(authorization(request));
    return operations.reconcile();
  });

  app.get('/api/v1/backups', async () => ({
    backups: await backups.list(),
  }));

  app.post('/api/v1/backups', async (request, reply) => {
    administrator.require(authorization(request));
    return reply.code(201).send(await backups.create());
  });

  app.delete('/api/v1/backups/:backupId', async (request, reply) => {
    administrator.require(authorization(request));
    const { backupId } = backupParametersSchema.parse(request.params);
    await backups.delete(backupId);
    return reply.code(204).send();
  });

  app.post('/api/v1/backups/:backupId/restore', async (request) => {
    administrator.require(authorization(request));
    const { backupId } = backupParametersSchema.parse(request.params);
    return backups.scheduleRestore(backupId);
  });

  app.get('/api/v1/updates/status', () => updates.getStatus());

  app.post('/api/v1/updates/check', (request) => {
    administrator.require(authorization(request));
    return updates.check();
  });

  app.post('/api/v1/updates/approve', (request) => {
    administrator.require(authorization(request));
    const input = approveUpdateRequestSchema.parse(request.body);
    return updates.approve(input.version);
  });
}
