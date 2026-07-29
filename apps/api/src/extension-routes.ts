import {
  chromeExtensionIdSchema,
  type ChromeExtensionListResponse,
  createChromeExtensionRequestSchema,
  updateChromeExtensionRequestSchema,
} from '@mediadeck/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdministratorAccess } from './administrator-access.js';
import type { ExtensionManager } from './extension-manager.js';

const profileParametersSchema = z.object({
  profileId: z.uuid(),
});

const extensionParametersSchema = profileParametersSchema.extend({
  extensionId: chromeExtensionIdSchema,
});

export function registerExtensionRoutes(
  app: FastifyInstance,
  extensions: ExtensionManager,
  administrator: AdministratorAccess,
): void {
  app.get(
    '/api/v1/profiles/:profileId/extensions',
    (request): ChromeExtensionListResponse => {
      const { profileId } = profileParametersSchema.parse(request.params);
      return { extensions: extensions.list(profileId) };
    },
  );

  app.post('/api/v1/profiles/:profileId/extensions', async (request, reply) => {
    administrator.require(request.headers.authorization);
    const { profileId } = profileParametersSchema.parse(request.params);
    const input = createChromeExtensionRequestSchema.parse(request.body);
    return reply.code(201).send(await extensions.add(profileId, input));
  });

  app.patch('/api/v1/profiles/:profileId/extensions/:extensionId', async (request) => {
    administrator.require(request.headers.authorization);
    const { extensionId, profileId } = extensionParametersSchema.parse(request.params);
    const input = updateChromeExtensionRequestSchema.parse(request.body);
    return extensions.setEnabled(profileId, extensionId, input.enabled);
  });

  app.delete(
    '/api/v1/profiles/:profileId/extensions/:extensionId',
    async (request, reply) => {
      administrator.require(request.headers.authorization);
      const { extensionId, profileId } = extensionParametersSchema.parse(
        request.params,
      );
      await extensions.remove(profileId, extensionId);
      return reply.code(204).send();
    },
  );
}
