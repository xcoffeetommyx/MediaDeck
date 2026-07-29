import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getStoragePaths } from '@mediadeck/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotFoundError } from './domain-errors.js';
import { ProfileManager } from './profile-manager.js';
import { ensureStorageLayout } from './storage.js';
import { MediaDeckStore } from './store.js';

let dataDirectory: string;
let profiles: ProfileManager;
let store: MediaDeckStore;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-profiles-'));
  const paths = await ensureStorageLayout(dataDirectory);
  store = new MediaDeckStore(paths.databaseFile);
  profiles = new ProfileManager(store, paths);
});

afterEach(async () => {
  store.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

describe('profile manager', () => {
  it('creates, updates, lists, and deletes a persistent profile', async () => {
    const profile = await profiles.create({
      avatarId: 'blue-fox',
      name: 'Living Room',
    });
    const paths = getStoragePaths(dataDirectory);

    await expect(
      access(join(paths.profiles, profile.id, 'brave-origin')),
    ).resolves.toBeUndefined();
    expect(profiles.list()).toEqual([profile]);

    await expect(
      profiles.update(profile.id, { name: 'Family' }),
    ).resolves.toMatchObject({
      avatarId: 'blue-fox',
      name: 'Family',
    });

    await profiles.delete(profile.id);
    expect(profiles.list()).toEqual([]);
    await expect(access(join(paths.profiles, profile.id))).rejects.toThrow();
  });

  it('reports a missing profile without touching other storage', () => {
    expect(() => profiles.get('51428272-68d9-4a9e-a242-c4f3ca1b0723')).toThrow(
      NotFoundError,
    );
  });

  it('persists profile metadata across database reopen', async () => {
    const created = await profiles.create({ name: 'Persistent' });
    const databaseFile = getStoragePaths(dataDirectory).databaseFile;

    store.close();
    store = new MediaDeckStore(databaseFile);
    profiles = new ProfileManager(store, getStoragePaths(dataDirectory));

    expect(profiles.get(created.id)).toEqual(created);
  });
});
