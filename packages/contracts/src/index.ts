import { z } from 'zod';

export const serviceStatusSchema = z.enum(['ok', 'degraded']);

export const healthResponseSchema = z.object({
  service: z.literal('mediadeck-api'),
  status: serviceStatusSchema,
  timestamp: z.iso.datetime(),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const publicConfigResponseSchema = z.object({
  appName: z.literal('MediaDeck'),
  environment: z.enum(['development', 'test', 'production']),
  version: z.string().min(1),
});

export type PublicConfigResponse = z.infer<typeof publicConfigResponseSchema>;
