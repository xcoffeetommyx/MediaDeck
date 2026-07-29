import {
  addonIdSchema,
  type ProfileAddonListResponse,
  updateProfileAddonRequestSchema,
} from '@mediadeck/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AddonManager } from './addon-manager.js';
import type { AdministratorAccess } from './administrator-access.js';

const profileParametersSchema = z.object({
  profileId: z.uuid(),
});

const addonParametersSchema = profileParametersSchema.extend({
  addonId: addonIdSchema,
});

export function registerAddonRoutes(
  app: FastifyInstance,
  addons: AddonManager,
  administrator: AdministratorAccess,
  maxPackageBytes: number,
): void {
  app.get('/api/v1/profiles/:profileId/addons', (request): ProfileAddonListResponse => {
    const { profileId } = profileParametersSchema.parse(request.params);
    return { addons: addons.list(profileId) };
  });

  app.post(
    '/api/v1/profiles/:profileId/addons',
    {
      bodyLimit: maxPackageBytes,
    },
    async (request, reply) => {
      administrator.require(request.headers.authorization);
      const { profileId } = profileParametersSchema.parse(request.params);
      const filename = request.headers['x-mediadeck-filename'];
      if (typeof filename !== 'string' || !filename.toLowerCase().endsWith('.xpi')) {
        return reply.code(400).send({
          error: 'invalid_addon_filename',
          message: 'Choose a Firefox .xpi package',
          statusCode: 400,
        });
      }
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({
          error: 'invalid_addon_package',
          message: 'The request body must contain an XPI package',
          statusCode: 400,
        });
      }
      return reply.code(201).send(await addons.install(profileId, request.body));
    },
  );

  app.patch('/api/v1/profiles/:profileId/addons/:addonId', async (request) => {
    administrator.require(request.headers.authorization);
    const { addonId, profileId } = addonParametersSchema.parse(request.params);
    const input = updateProfileAddonRequestSchema.parse(request.body);
    return addons.setEnabled(profileId, addonId, input.enabled);
  });

  app.delete('/api/v1/profiles/:profileId/addons/:addonId', async (request, reply) => {
    administrator.require(request.headers.authorization);
    const { addonId, profileId } = addonParametersSchema.parse(request.params);
    await addons.remove(profileId, addonId);
    return reply.code(204).send();
  });

  app.post('/api/v1/addons/watch/scan', async (request) => {
    administrator.require(request.headers.authorization);
    return addons.scanWatchedDirectory();
  });
}
