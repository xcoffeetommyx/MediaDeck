import {
  type BrowserSessionListResponse,
  createBrowserSessionRequestSchema,
} from '@mediadeck/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SessionManager } from './session-manager.js';

const sessionParametersSchema = z.object({
  sessionId: z.uuid(),
});

export function registerSessionRoutes(
  app: FastifyInstance,
  sessions: SessionManager,
): void {
  app.get('/api/v1/sessions', (): BrowserSessionListResponse => {
    return {
      sessions: sessions.list(),
    };
  });

  app.post('/api/v1/sessions', async (request, reply) => {
    const input = createBrowserSessionRequestSchema.parse(request.body);
    const session = await sessions.start(input);
    return reply.code(201).send(session);
  });

  app.get('/api/v1/sessions/:sessionId', (request) => {
    const { sessionId } = sessionParametersSchema.parse(request.params);
    return sessions.get(sessionId);
  });

  app.post('/api/v1/sessions/:sessionId/heartbeat', async (request) => {
    const { sessionId } = sessionParametersSchema.parse(request.params);
    return sessions.heartbeat(sessionId);
  });

  app.post('/api/v1/sessions/:sessionId/recover', async (request) => {
    const { sessionId } = sessionParametersSchema.parse(request.params);
    return sessions.recover(sessionId);
  });

  app.post('/api/v1/sessions/:sessionId/stop', async (request) => {
    const { sessionId } = sessionParametersSchema.parse(request.params);
    return sessions.stop(sessionId);
  });
}
