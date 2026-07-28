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

const serverEnvironmentSchema = z.object({
  APP_VERSION: z.string().min(1).default('0.1.0'),
  BROWSER_WORKER_URL: httpUrl.optional(),
  DATA_DIR: z.string().min(1).default('./.data'),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  PUBLIC_DIR: z.string().min(1).optional(),
  TRUST_PROXY: booleanFromEnvironment,
});

export type ServerConfig = {
  appVersion: string;
  browserWorkerUrl?: string;
  dataDirectory: string;
  host: string;
  logLevel: z.infer<typeof serverEnvironmentSchema>['LOG_LEVEL'];
  nodeEnvironment: z.infer<typeof serverEnvironmentSchema>['NODE_ENV'];
  port: number;
  publicDirectory?: string;
  trustProxy: boolean;
};

export type StoragePaths = {
  backups: string;
  database: string;
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
  };
}

export function getStoragePaths(dataDirectory: string): StoragePaths {
  const root = resolve(dataDirectory);

  return {
    backups: resolve(root, 'backups'),
    database: resolve(root, 'database'),
    profiles: resolve(root, 'profiles'),
    root,
    runtime: resolve(root, 'runtime'),
  };
}
