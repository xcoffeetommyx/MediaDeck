import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AddonConfig, StoragePaths } from '@mediadeck/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AddonManager } from './addon-manager.js';
import {
  ConflictError,
  IncompatibleAddonError,
  InvalidAddonError,
} from './domain-errors.js';
import { ProfileManager } from './profile-manager.js';
import { ensureStorageLayout } from './storage.js';
import { MediaDeckStore } from './store.js';

type XpiManifestOptions = {
  id?: string;
  maxFirefoxVersion?: string;
  minFirefoxVersion?: string;
  name?: string;
  signed?: boolean;
  version?: string;
};

function createStoredZip(entries: { data: Buffer; name: string }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }

  const localDirectory = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localDirectory.length, 16);
  return Buffer.concat([localDirectory, centralDirectory, end]);
}

function createXpi({
  id = 'stage8@example.test',
  maxFirefoxVersion,
  minFirefoxVersion,
  name = 'Stage Eight',
  signed = true,
  version = '1.0.0',
}: XpiManifestOptions = {}): Buffer {
  const manifest = {
    browser_specific_settings: {
      gecko: {
        id,
        ...(maxFirefoxVersion ? { strict_max_version: maxFirefoxVersion } : {}),
        ...(minFirefoxVersion ? { strict_min_version: minFirefoxVersion } : {}),
      },
    },
    manifest_version: 3,
    name,
    permissions: ['storage', 'https://www.youtube.com/*'],
    version,
  };
  return createStoredZip([
    {
      data: Buffer.from(JSON.stringify(manifest)),
      name: 'manifest.json',
    },
    ...(signed
      ? [{ data: Buffer.from('test-signature'), name: 'META-INF/mozilla.rsa' }]
      : []),
  ]);
}

let addons: AddonManager;
let config: AddonConfig;
let dataDirectory: string;
let paths: StoragePaths;
let profiles: ProfileManager;
let store: MediaDeckStore;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-addons-'));
  paths = await ensureStorageLayout(dataDirectory);
  store = new MediaDeckStore(paths.databaseFile);
  profiles = new ProfileManager(store, paths);
  config = {
    firefoxMajorVersion: 153,
    maxPackageBytes: 25 * 1024 * 1024,
    watchEnabled: false,
    watchIntervalSeconds: 60,
  };
  addons = new AddonManager({
    config,
    now: () => new Date('2026-07-28T12:00:00.000Z'),
    paths,
    store,
  });
  await addons.initialize();
});

afterEach(async () => {
  addons.close();
  store.close();
  await rm(dataDirectory, { force: true, recursive: true });
});

describe('Firefox add-on manager', () => {
  it('installs a signed compatible XPI only for the selected profile', async () => {
    const first = await profiles.create({ name: 'First' });
    const second = await profiles.create({ name: 'Second' });

    const addon = await addons.install(first.id, createXpi());

    expect(addon).toMatchObject({
      enabled: true,
      id: 'stage8@example.test',
      permissions: ['https://www.youtube.com/*', 'storage'],
      profileId: first.id,
      version: '1.0.0',
    });
    expect(addons.list(second.id)).toEqual([]);
    const policy = JSON.parse(
      await readFile(
        join(
          paths.profiles,
          first.id,
          'firefox',
          'mediadeck',
          'policy',
          'policies.json',
        ),
        'utf8',
      ),
    ) as {
      policies: {
        ExtensionSettings: Record<string, Record<string, unknown>>;
      };
    };
    expect(policy.policies.ExtensionSettings['stage8@example.test']).toMatchObject({
      installation_mode: 'force_installed',
      updates_disabled: true,
    });
  });

  it('disables, re-enables, and removes an add-on through policy state', async () => {
    const profile = await profiles.create({ name: 'Toggle' });
    const installed = await addons.install(profile.id, createXpi());

    expect(await addons.setEnabled(profile.id, installed.id, false)).toMatchObject({
      enabled: false,
    });
    const disabledPolicy = await readFile(
      join(
        paths.profiles,
        profile.id,
        'firefox',
        'mediadeck',
        'policy',
        'policies.json',
      ),
      'utf8',
    );
    expect(disabledPolicy).toContain('"installation_mode": "blocked"');

    expect(await addons.setEnabled(profile.id, installed.id, true)).toMatchObject({
      enabled: true,
    });
    await addons.remove(profile.id, installed.id);
    expect(addons.list(profile.id)).toEqual([]);
    expect(
      await readdir(join(paths.profiles, profile.id, 'firefox', 'mediadeck', 'addons')),
    ).toEqual([]);
  });

  it('accepts only newer replacement packages for the same extension ID', async () => {
    const profile = await profiles.create({ name: 'Updates' });
    await addons.install(profile.id, createXpi({ version: '1.2.0' }));

    await expect(
      addons.install(profile.id, createXpi({ version: '1.1.9' })),
    ).rejects.toThrow(ConflictError);
    await expect(
      addons.install(profile.id, createXpi({ version: '2.0.0' })),
    ).resolves.toMatchObject({ version: '2.0.0' });
  });

  it('rejects unsigned and incompatible packages without inventory changes', async () => {
    const profile = await profiles.create({ name: 'Validation' });

    await expect(
      addons.install(profile.id, createXpi({ signed: false })),
    ).rejects.toThrow(InvalidAddonError);
    await expect(
      addons.install(profile.id, createXpi({ minFirefoxVersion: '154.0' })),
    ).rejects.toThrow(IncompatibleAddonError);
    expect(addons.list(profile.id)).toEqual([]);
  });

  it('refuses changes while the selected profile has an active worker', async () => {
    const profile = await profiles.create({ name: 'Active' });
    const timestamp = '2026-07-28T12:00:00.000Z';
    store.createSession(
      {
        accessTokenHash: 'hash',
        applicationId: 'youtube',
        createdAt: timestamp,
        id: 'be430605-05d2-40fd-87a6-4359ac38a77d',
        kind: 'profile',
        lastSeenAt: timestamp,
        profileId: profile.id,
        storagePath: `profiles/${profile.id}/firefox`,
        updatedAt: timestamp,
      },
      1,
    );

    await expect(addons.install(profile.id, createXpi())).rejects.toThrow(
      ConflictError,
    );
  });

  it('imports valid watched packages and quarantines invalid ones', async () => {
    const profile = await profiles.create({ name: 'Watched' });
    const inbox = join(paths.addonInbox, profile.id);
    await mkdir(inbox, { recursive: true });
    await writeFile(join(inbox, 'valid.xpi'), createXpi());
    await writeFile(join(inbox, 'invalid.xpi'), Buffer.from('not an xpi'));

    const result = await addons.scanWatchedDirectory();

    expect(result).toEqual({ imported: 1, rejected: 1, skipped: 0 });
    expect(addons.list(profile.id)[0]).toMatchObject({ source: 'watched' });
    await expect(access(join(inbox, 'valid.xpi'))).rejects.toThrow();
    await expect(access(join(inbox, 'invalid.xpi'))).rejects.toThrow();
    const rejected = await readdir(join(paths.addonRejected, profile.id));
    expect(rejected.some((name) => name.endsWith('-invalid.xpi'))).toBe(true);
    expect(rejected.some((name) => name.endsWith('.error.json'))).toBe(true);
  });

  it('removes add-on metadata and packages when a profile is deleted', async () => {
    const profile = await profiles.create({ name: 'Disposable' });
    await addons.install(profile.id, createXpi());

    await profiles.delete(profile.id);

    expect(store.getProfileAddon(profile.id, 'stage8@example.test')).toBeUndefined();
    await expect(access(join(paths.profiles, profile.id))).rejects.toThrow();
  });
});
