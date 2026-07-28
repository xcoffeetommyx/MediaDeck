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

export const browserTransportModeSchema = z.enum(['websocket', 'webrtc']);

export const browserWorkerCapabilitiesSchema = z.object({
  audio: z.boolean(),
  gamepad: z.boolean(),
  keyboard: z.boolean(),
  pointer: z.boolean(),
  reconnect: z.boolean(),
  touch: z.boolean(),
});

export const browserWorkerHealthResponseSchema = z.object({
  capabilities: browserWorkerCapabilitiesSchema,
  checkedAt: z.iso.datetime(),
  detail: z.string().min(1).optional(),
  status: z.enum(['online', 'offline', 'unconfigured']),
  transport: z.object({
    mode: browserTransportModeSchema,
    provider: z.string().min(1),
  }),
});

export type BrowserTransportMode = z.infer<typeof browserTransportModeSchema>;
export type BrowserWorkerCapabilities = z.infer<typeof browserWorkerCapabilitiesSchema>;
export type BrowserWorkerHealthResponse = z.infer<
  typeof browserWorkerHealthResponseSchema
>;
