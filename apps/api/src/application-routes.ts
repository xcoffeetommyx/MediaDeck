import {
  launchMediaApplicationRequestSchema,
  type MediaApplicationListResponse,
} from '@mediadeck/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApplicationRegistry } from './application-registry.js';
import type { SessionManager } from './session-manager.js';

const applicationParametersSchema = z.object({
  applicationId: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,32}$/),
});

export function registerApplicationRoutes(
  app: FastifyInstance,
  applications: ApplicationRegistry,
  sessions: SessionManager,
): void {
  app.get('/api/v1/applications', (): MediaApplicationListResponse => {
    return {
      applications: applications.list(),
    };
  });

  app.post('/api/v1/applications/:applicationId/launch', async (request) => {
    const { applicationId } = applicationParametersSchema.parse(request.params);
    const input = launchMediaApplicationRequestSchema.parse(request.body);
    return sessions.launch(applicationId, input);
  });
}
