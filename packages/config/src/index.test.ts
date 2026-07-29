import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getStoragePaths, loadServerConfig } from './index.js';

describe('server configuration', () => {
  it('loads safe development defaults', () => {
    const config = loadServerConfig({});

    expect(config).toMatchObject({
      appVersion: '0.1.0',
      browserWorker: {
        framerate: 30,
        gpuMode: 'auto',
        image: 'mediadeck-brave-origin:0.1.0',
        vaapiDriver: 'auto',
        videoBitrate: 6,
      },
      host: '0.0.0.0',
      nodeEnvironment: 'development',
      port: 3000,
      trustProxy: false,
    });
  });

  it('coerces validated environment values', () => {
    const config = loadServerConfig({
      APP_VERSION: '2.0.0',
      BROWSER_SESSION_IDLE_TIMEOUT_SECONDS: '600',
      BROWSER_WORKER_CPUS: '1.5',
      BROWSER_WORKER_DRIVER: 'docker',
      BROWSER_WORKER_MEMORY_MB: '1536',
      BROWSER_WORKER_URL: 'http://browser-worker:3000',
      DATA_DIR: './custom-data',
      NODE_ENV: 'production',
      PORT: '4242',
      TRUST_PROXY: 'true',
    });

    expect(config.port).toBe(4242);
    expect(config.browserWorkerUrl).toBe('http://browser-worker:3000');
    expect(config.browserWorker).toMatchObject({
      driver: 'docker',
      cpus: 1.5,
      idleTimeoutSeconds: 600,
      maxSessions: 1,
      memoryMegabytes: 1536,
    });
    expect(config.trustProxy).toBe(true);
    expect(config.dataDirectory).toBe(resolve('./custom-data'));
  });

  it('rejects an invalid port', () => {
    expect(() => loadServerConfig({ PORT: '70000' })).toThrow();
  });

  it('rejects an invalid browser worker URL', () => {
    expect(() =>
      loadServerConfig({ BROWSER_WORKER_URL: 'browser-worker:3000' }),
    ).toThrow();
  });

  it('accepts only HTTPS update manifests and ignores an empty Compose value', () => {
    expect(
      loadServerConfig({
        MEDIADECK_UPDATE_MANIFEST_URL: '',
      }).updateManifestUrl,
    ).toBeUndefined();
    expect(
      loadServerConfig({
        MEDIADECK_UPDATE_MANIFEST_URL: 'https://updates.example.test/stable.json',
      }).updateManifestUrl,
    ).toBe('https://updates.example.test/stable.json');
    expect(() =>
      loadServerConfig({
        MEDIADECK_UPDATE_MANIFEST_URL: 'http://updates.example.test/stable.json',
      }),
    ).toThrow();
  });

  it('rejects unsafe browser session capacity and timeouts', () => {
    expect(() => loadServerConfig({ MAX_BROWSER_SESSIONS: '0' })).toThrow();
    expect(() =>
      loadServerConfig({ BROWSER_SESSION_IDLE_TIMEOUT_SECONDS: '30' }),
    ).toThrow();
  });

  it('rejects a worker UID that would take ownership away from the app', () => {
    expect(() => loadServerConfig({ BROWSER_PUID: '1001' })).toThrow(
      'BROWSER_PUID must remain 1000',
    );
  });
});

describe('storage paths', () => {
  it('keeps every persistent path beneath the configured root', () => {
    const paths = getStoragePaths('./data-root');

    for (const path of Object.values(paths)) {
      expect(path.startsWith(paths.root)).toBe(true);
    }
  });
});
