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

export const profileNameSchema = z.string().trim().min(1).max(48);
export const profileAvatarIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{1,32}$/);

export const profileSchema = z.object({
  avatarId: profileAvatarIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  name: profileNameSchema,
  updatedAt: z.iso.datetime(),
});

export const profileListResponseSchema = z.object({
  profiles: z.array(profileSchema),
});

export const createProfileRequestSchema = z.object({
  avatarId: profileAvatarIdSchema.nullable().optional(),
  name: profileNameSchema,
});

export const updateProfileRequestSchema = createProfileRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required',
  });

export type Profile = z.infer<typeof profileSchema>;
export type ProfileListResponse = z.infer<typeof profileListResponseSchema>;
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const browserSessionKindSchema = z.enum(['profile', 'guest']);
export const browserSessionStatusSchema = z.enum([
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
]);

export const browserSessionSchema = z.object({
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  failureReason: z.string().min(1).nullable(),
  id: z.uuid(),
  kind: browserSessionKindSchema,
  lastSeenAt: z.iso.datetime(),
  profileId: z.uuid().nullable(),
  status: browserSessionStatusSchema,
  updatedAt: z.iso.datetime(),
});

export const browserSessionListResponseSchema = z.object({
  sessions: z.array(browserSessionSchema),
});

export const createBrowserSessionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('profile'),
    profileId: z.uuid(),
  }),
  z.object({
    kind: z.literal('guest'),
  }),
]);

export type BrowserSessionKind = z.infer<typeof browserSessionKindSchema>;
export type BrowserSessionStatus = z.infer<typeof browserSessionStatusSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type BrowserSessionListResponse = z.infer<
  typeof browserSessionListResponseSchema
>;
export type CreateBrowserSessionRequest = z.infer<
  typeof createBrowserSessionRequestSchema
>;
