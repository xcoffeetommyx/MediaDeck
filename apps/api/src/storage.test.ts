import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureStorageLayout } from './storage.js';

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-storage-'));
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe('persistent storage layout', () => {
  it('creates each required directory', async () => {
    const paths = await ensureStorageLayout(dataDirectory);

    await expect(
      Promise.all(
        [
          paths.database,
          paths.profiles,
          paths.backups,
          paths.runtime,
          paths.guests,
          paths.locks,
        ].map(async (path) => access(path)),
      ),
    ).resolves.toBeDefined();
  });
});
