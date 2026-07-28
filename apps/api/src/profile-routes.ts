import {
  createProfileRequestSchema,
  type ProfileListResponse,
  updateProfileRequestSchema,
} from '@mediadeck/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdministratorAccess } from './administrator-access.js';
import type { ProfileManager } from './profile-manager.js';

const profileParametersSchema = z.object({
  profileId: z.uuid(),
});

export function registerProfileRoutes(
  app: FastifyInstance,
  profiles: ProfileManager,
  administrator: AdministratorAccess,
): void {
  app.get('/api/v1/profiles', (): ProfileListResponse => {
    return {
      profiles: profiles.list(),
    };
  });

  app.post('/api/v1/profiles', async (request, reply) => {
    const input = createProfileRequestSchema.parse(request.body);
    const profile = await profiles.create(input);
    return reply.code(201).send(profile);
  });

  app.get('/api/v1/profiles/:profileId', (request) => {
    const { profileId } = profileParametersSchema.parse(request.params);
    return profiles.get(profileId);
  });

  app.patch('/api/v1/profiles/:profileId', (request) => {
    const { profileId } = profileParametersSchema.parse(request.params);
    const input = updateProfileRequestSchema.parse(request.body);
    return profiles.update(profileId, input);
  });

  app.delete('/api/v1/profiles/:profileId', async (request, reply) => {
    administrator.require(request.headers.authorization);
    const { profileId } = profileParametersSchema.parse(request.params);
    await profiles.delete(profileId);
    return reply.code(204).send();
  });
}
