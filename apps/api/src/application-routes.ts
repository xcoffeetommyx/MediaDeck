import {
  launchMediaApplicationRequestSchema,
  type MediaApplicationListResponse,
} from '@mediadeck/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApplicationRegistry } from './application-registry.js';
import { setStreamAccessCookie } from './session-access.js';
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
  secureCookies: boolean,
): void {
  app.get('/api/v1/applications', (): MediaApplicationListResponse => {
    return {
      applications: applications.list(),
    };
  });

  app.post('/api/v1/applications/:applicationId/launch', async (request, reply) => {
    const { applicationId } = applicationParametersSchema.parse(request.params);
    const input = launchMediaApplicationRequestSchema.parse(request.body);
    const session = await sessions.launch(applicationId, input);
    setStreamAccessCookie(
      reply,
      session.id,
      input.accessToken,
      sessions.capacity().idleTimeoutSeconds,
      secureCookies,
    );
    return session;
  });
}
