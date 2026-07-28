import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getStoragePaths, loadServerConfig } from './index.js';

describe('server configuration', () => {
  it('loads safe development defaults', () => {
    const config = loadServerConfig({});

    expect(config).toMatchObject({
      appVersion: '0.1.0',
      host: '0.0.0.0',
      nodeEnvironment: 'development',
      port: 3000,
      trustProxy: false,
    });
  });

  it('coerces validated environment values', () => {
    const config = loadServerConfig({
      APP_VERSION: '2.0.0',
      DATA_DIR: './custom-data',
      NODE_ENV: 'production',
      PORT: '4242',
      TRUST_PROXY: 'true',
    });

    expect(config.port).toBe(4242);
    expect(config.trustProxy).toBe(true);
    expect(config.dataDirectory).toBe(resolve('./custom-data'));
  });

  it('rejects an invalid port', () => {
    expect(() => loadServerConfig({ PORT: '70000' })).toThrow();
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
