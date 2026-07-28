import { resolve } from 'node:path';

import { z } from 'zod';

const booleanFromEnvironment = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Must use the http or https protocol');

const httpsUrl = z
  .url()
  .refine(
    (value) => new URL(value).protocol === 'https:',
    'Must use the https protocol',
  );

const browserWorkerImage =
  'ghcr.io/linuxserver/firefox@sha256:e4b9310d76fbaef54de9b6a440113729c442125f50668ad9e9f678c0af1ae700';

const serverEnvironmentSchema = z.object({
  APP_VERSION: z.string().min(1).default('0.1.0'),
  BROWSER_DATA_VOLUME: z.string().min(1).default('mediadeck-data'),
  BROWSER_FRAMERATE: z.coerce.number().int().min(8).max(120).default(60),
  BROWSER_PGID: z.coerce.number().int().nonnegative().default(1000),
  BROWSER_PUID: z.coerce.number().int().nonnegative().default(1000),
  BROWSER_SESSION_HEALTH_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(5)
    .max(300)
    .default(15),
  BROWSER_SESSION_IDLE_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(1800),
  BROWSER_START_URL: httpUrl.default('https://www.youtube.com/'),
  BROWSER_VIDEO_BITRATE: z.coerce.number().int().min(1).max(100).default(12),
  BROWSER_WORKER_DRIVER: z.enum(['disabled', 'docker']).default('disabled'),
  BROWSER_WORKER_IMAGE: z.string().min(1).default(browserWorkerImage),
  BROWSER_WORKER_NETWORK: z.string().min(1).default('mediadeck_default'),
  BROWSER_WORKER_URL: httpUrl.optional(),
  DATA_DIR: z.string().min(1).default('./.data'),
  DOCKER_SOCKET_PATH: z.string().min(1).default('/var/run/docker.sock'),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MAX_BROWSER_SESSIONS: z.coerce.number().int().min(1).max(16).default(1),
  MEDIADECK_UPDATE_MANIFEST_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    httpsUrl.optional(),
  ),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  PUBLIC_DIR: z.string().min(1).optional(),
  TRUST_PROXY: booleanFromEnvironment,
  TZ: z.string().min(1).default('Etc/UTC'),
});

export type BrowserWorkerConfig = {
  dataVolumeName: string;
  dockerSocketPath: string;
  driver: z.infer<typeof serverEnvironmentSchema>['BROWSER_WORKER_DRIVER'];
  framerate: number;
  healthIntervalSeconds: number;
  idleTimeoutSeconds: number;
  image: string;
  maxSessions: number;
  network: string;
  pgid: number;
  puid: number;
  startUrl: string;
  timezone: string;
  videoBitrate: number;
};

export type ServerConfig = {
  appVersion: string;
  browserWorker: BrowserWorkerConfig;
  browserWorkerUrl?: string;
  dataDirectory: string;
  host: string;
  logLevel: z.infer<typeof serverEnvironmentSchema>['LOG_LEVEL'];
  nodeEnvironment: z.infer<typeof serverEnvironmentSchema>['NODE_ENV'];
  port: number;
  publicDirectory?: string;
  trustProxy: boolean;
  updateManifestUrl?: string;
};

export type StoragePaths = {
  backups: string;
  database: string;
  databaseFile: string;
  guests: string;
  locks: string;
  profiles: string;
  root: string;
  runtime: string;
};

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const parsed = serverEnvironmentSchema.parse(environment);
  const publicDirectory = parsed.PUBLIC_DIR ? resolve(parsed.PUBLIC_DIR) : undefined;

  return {
    appVersion: parsed.APP_VERSION,
    browserWorker: {
      dataVolumeName: parsed.BROWSER_DATA_VOLUME,
      dockerSocketPath: parsed.DOCKER_SOCKET_PATH,
      driver: parsed.BROWSER_WORKER_DRIVER,
      framerate: parsed.BROWSER_FRAMERATE,
      healthIntervalSeconds: parsed.BROWSER_SESSION_HEALTH_INTERVAL_SECONDS,
      idleTimeoutSeconds: parsed.BROWSER_SESSION_IDLE_TIMEOUT_SECONDS,
      image: parsed.BROWSER_WORKER_IMAGE,
      maxSessions: parsed.MAX_BROWSER_SESSIONS,
      network: parsed.BROWSER_WORKER_NETWORK,
      pgid: parsed.BROWSER_PGID,
      puid: parsed.BROWSER_PUID,
      startUrl: parsed.BROWSER_START_URL,
      timezone: parsed.TZ,
      videoBitrate: parsed.BROWSER_VIDEO_BITRATE,
    },
    ...(parsed.BROWSER_WORKER_URL
      ? { browserWorkerUrl: parsed.BROWSER_WORKER_URL }
      : {}),
    dataDirectory: resolve(parsed.DATA_DIR),
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    nodeEnvironment: parsed.NODE_ENV,
    port: parsed.PORT,
    ...(publicDirectory ? { publicDirectory } : {}),
    trustProxy: parsed.TRUST_PROXY,
    ...(parsed.MEDIADECK_UPDATE_MANIFEST_URL
      ? { updateManifestUrl: parsed.MEDIADECK_UPDATE_MANIFEST_URL }
      : {}),
  };
}

export function getStoragePaths(dataDirectory: string): StoragePaths {
  const root = resolve(dataDirectory);

  return {
    backups: resolve(root, 'backups'),
    database: resolve(root, 'database'),
    databaseFile: resolve(root, 'database', 'mediadeck.sqlite'),
    guests: resolve(root, 'runtime', 'guests'),
    locks: resolve(root, 'runtime', 'locks'),
    profiles: resolve(root, 'profiles'),
    root,
    runtime: resolve(root, 'runtime'),
  };
}
