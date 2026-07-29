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

export const addonIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    {
      message: 'Add-on ID contains unsupported characters',
    },
  );

export const addonVersionSchema = z
  .string()
  .trim()
  .regex(
    /^\d+(?:\.\d+){0,3}(?:[A-Za-z][0-9A-Za-z.-]*)?$/,
    'Add-on version is unsupported',
  );

export const profileAddonSchema = z.object({
  enabled: z.boolean(),
  id: addonIdSchema,
  installedAt: z.iso.datetime(),
  maxFirefoxVersion: z.string().nullable(),
  minFirefoxVersion: z.string().nullable(),
  name: z.string().min(1).max(128),
  permissions: z.array(z.string().min(1).max(255)).max(256),
  profileId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(['upload', 'watched']),
  updatedAt: z.iso.datetime(),
  version: addonVersionSchema,
});

export const profileAddonListResponseSchema = z.object({
  addons: z.array(profileAddonSchema),
});

export const updateProfileAddonRequestSchema = z.object({
  enabled: z.boolean(),
});

export const addonWatchScanResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export type ProfileAddon = z.infer<typeof profileAddonSchema>;
export type ProfileAddonListResponse = z.infer<typeof profileAddonListResponseSchema>;
export type UpdateProfileAddonRequest = z.infer<typeof updateProfileAddonRequestSchema>;
export type AddonWatchScanResponse = z.infer<typeof addonWatchScanResponseSchema>;

export const mediaApplicationIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{1,32}$/);

export const mediaApplicationSchema = z.object({
  available: z.boolean(),
  description: z.string().min(1),
  displayName: z.string().min(1),
  id: mediaApplicationIdSchema,
});

export const mediaApplicationListResponseSchema = z.object({
  applications: z.array(mediaApplicationSchema),
});

export type MediaApplication = z.infer<typeof mediaApplicationSchema>;
export type MediaApplicationId = z.infer<typeof mediaApplicationIdSchema>;
export type MediaApplicationListResponse = z.infer<
  typeof mediaApplicationListResponseSchema
>;

export const browserSessionKindSchema = z.enum(['profile', 'guest']);
export const browserSessionStatusSchema = z.enum([
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
]);

export const sessionAccessTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,128}$/, 'Session access token is invalid');

export const browserSessionSchema = z.object({
  applicationId: mediaApplicationIdSchema,
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  failureReason: z.string().min(1).nullable(),
  id: z.uuid(),
  kind: browserSessionKindSchema,
  lastSeenAt: z.iso.datetime(),
  profileId: z.uuid().nullable(),
  status: browserSessionStatusSchema,
  streamUrl: z.string().startsWith('/stream/').endsWith('/'),
  updatedAt: z.iso.datetime(),
});

export const browserSessionListResponseSchema = z.object({
  sessions: z.array(browserSessionSchema),
});

export const createBrowserSessionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    accessToken: sessionAccessTokenSchema,
    applicationId: mediaApplicationIdSchema.default('youtube'),
    kind: z.literal('profile'),
    profileId: z.uuid(),
    sessionId: z.uuid().optional(),
  }),
  z.object({
    accessToken: sessionAccessTokenSchema,
    applicationId: mediaApplicationIdSchema.default('youtube'),
    kind: z.literal('guest'),
    sessionId: z.uuid().optional(),
  }),
]);

export const launchMediaApplicationRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    accessToken: sessionAccessTokenSchema,
    kind: z.literal('profile'),
    profileId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({
    accessToken: sessionAccessTokenSchema,
    kind: z.literal('guest'),
    sessionId: z.uuid(),
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
export type LaunchMediaApplicationRequest = z.infer<
  typeof launchMediaApplicationRequestSchema
>;

export const sessionCapacitySchema = z.object({
  activeSessions: z.number().int().nonnegative(),
  availableSlots: z.number().int().nonnegative(),
  atCapacity: z.boolean(),
  idleTimeoutSeconds: z.number().int().positive(),
  maxSessions: z.number().int().positive(),
});

export const browserWorkerResourceSampleSchema = z.object({
  cpuPercent: z.number().nonnegative().nullable(),
  gpu: z.object({
    device: z.string().nullable(),
    mode: z.enum(['software', 'dri']),
  }),
  memoryBytes: z.number().int().nonnegative(),
  memoryLimitBytes: z.number().int().nonnegative(),
  networkReceiveBytes: z.number().int().nonnegative(),
  networkTransmitBytes: z.number().int().nonnegative(),
  pids: z.number().int().nonnegative(),
  profileId: z.uuid().nullable(),
  sampledAt: z.iso.datetime(),
  sessionId: z.uuid(),
  status: browserSessionStatusSchema,
  videoBitrateMbps: z.number().positive(),
});

export const browserResourceReportSchema = z.object({
  capacity: sessionCapacitySchema,
  limitsPerWorker: z.object({
    cpus: z.number().positive(),
    memoryBytes: z.number().int().positive(),
    pids: z.number().int().positive(),
    sharedMemoryBytes: z.number().int().positive(),
    videoBitrateMbps: z.number().positive(),
  }),
  sampledAt: z.iso.datetime(),
  sessions: z.array(browserWorkerResourceSampleSchema),
});

export type SessionCapacity = z.infer<typeof sessionCapacitySchema>;
export type BrowserWorkerResourceSample = z.infer<
  typeof browserWorkerResourceSampleSchema
>;
export type BrowserResourceReport = z.infer<typeof browserResourceReportSchema>;

export const administratorPinSchema = z
  .string()
  .regex(/^\d{4,12}$/, 'PIN must contain 4 to 12 digits');

export const administratorStatusSchema = z.object({
  authenticated: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  pinEnabled: z.boolean(),
});

export const unlockAdministratorRequestSchema = z.object({
  pin: administratorPinSchema,
});

export const unlockAdministratorResponseSchema = z.object({
  status: administratorStatusSchema,
  token: z.string().min(32),
});

export const setAdministratorPinRequestSchema = z.object({
  pin: administratorPinSchema.nullable(),
});

export type AdministratorStatus = z.infer<typeof administratorStatusSchema>;
export type UnlockAdministratorRequest = z.infer<
  typeof unlockAdministratorRequestSchema
>;
export type UnlockAdministratorResponse = z.infer<
  typeof unlockAdministratorResponseSchema
>;
export type SetAdministratorPinRequest = z.infer<
  typeof setAdministratorPinRequestSchema
>;

export const streamQualityPresetSchema = z.enum([
  'data-saver',
  'balanced',
  'smooth',
  'high-quality',
]);

export const administratorSettingsSchema = z.object({
  automaticUpdateChecks: z.boolean(),
  backupRetentionCount: z.number().int().min(1).max(20),
  streamQualityPreset: streamQualityPresetSchema.default('balanced'),
});

export const updateAdministratorSettingsRequestSchema = administratorSettingsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one setting is required',
  });

export type AdministratorSettings = z.infer<typeof administratorSettingsSchema>;
export type StreamQualityPreset = z.infer<typeof streamQualityPresetSchema>;
export type UpdateAdministratorSettingsRequest = z.infer<
  typeof updateAdministratorSettingsRequestSchema
>;

export const operationEventSchema = z.object({
  category: z.enum([
    'addon',
    'administration',
    'backup',
    'profile',
    'recovery',
    'session',
    'system',
    'update',
  ]),
  createdAt: z.iso.datetime(),
  id: z.number().int().positive(),
  level: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1),
});

export const operationEventListResponseSchema = z.object({
  events: z.array(operationEventSchema),
});

export type OperationEvent = z.infer<typeof operationEventSchema>;
export type OperationEventListResponse = z.infer<
  typeof operationEventListResponseSchema
>;

export const operationalDiagnosticsSchema = z.object({
  activeSessions: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime(),
  database: z.object({
    healthy: z.boolean(),
    schemaVersion: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
  }),
  failedSessions: z.number().int().nonnegative(),
  lastBackupAt: z.iso.datetime().nullable(),
  profiles: z.number().int().nonnegative(),
  status: z.enum(['healthy', 'degraded']),
  storage: z.object({
    availableBytes: z.number().int().nonnegative(),
    writable: z.boolean(),
  }),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string().min(1),
  worker: z.object({
    detail: z.string().min(1).nullable(),
    status: z.enum(['online', 'offline', 'unconfigured']),
  }),
});

export type OperationalDiagnostics = z.infer<typeof operationalDiagnosticsSchema>;

export const backupSummarySchema = z.object({
  appVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,96}$/),
  profileCount: z.number().int().nonnegative(),
  schemaVersion: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

export const backupListResponseSchema = z.object({
  backups: z.array(backupSummarySchema),
});

export const restoreBackupResponseSchema = z.object({
  backupId: backupSummarySchema.shape.id,
  restartRequired: z.literal(true),
  scheduledAt: z.iso.datetime(),
});

export type BackupSummary = z.infer<typeof backupSummarySchema>;
export type BackupListResponse = z.infer<typeof backupListResponseSchema>;
export type RestoreBackupResponse = z.infer<typeof restoreBackupResponseSchema>;

export const updateManifestSchema = z.object({
  image: z
    .string()
    .regex(
      /^[a-z0-9./_-]+(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$/,
      'Update image must be pinned to a sha256 digest',
    ),
  publishedAt: z.iso.datetime(),
  releaseNotesUrl: z.url().startsWith('https://').optional(),
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
});

export const availableUpdateSchema = updateManifestSchema.omit({
  schemaVersion: true,
});

export const updateStatusSchema = z.object({
  approvedAt: z.iso.datetime().nullable(),
  backupId: backupSummarySchema.shape.id.nullable(),
  checkedAt: z.iso.datetime().nullable(),
  installedVersion: z.string().min(1),
  manifestConfigured: z.boolean(),
  message: z.string().min(1).nullable(),
  release: availableUpdateSchema.nullable(),
  state: z.enum(['unconfigured', 'current', 'available', 'approved', 'error']),
});

export const approveUpdateRequestSchema = z.object({
  version: updateManifestSchema.shape.version,
});

export type UpdateManifest = z.infer<typeof updateManifestSchema>;
export type AvailableUpdate = z.infer<typeof availableUpdateSchema>;
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
export type ApproveUpdateRequest = z.infer<typeof approveUpdateRequestSchema>;
