import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  CreateProfileRequest,
  Profile,
  UpdateProfileRequest,
} from '@mediadeck/contracts';
import type { StoragePaths } from '@mediadeck/config';

import { MediaDeckStore } from './store.js';

export class ProfileManager {
  constructor(
    private readonly store: MediaDeckStore,
    private readonly paths: StoragePaths,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreateProfileRequest): Promise<Profile> {
    const id = randomUUID();
    const timestamp = this.now().toISOString();
    const profile: Profile = {
      avatarId: input.avatarId ?? null,
      createdAt: timestamp,
      id,
      name: input.name,
      updatedAt: timestamp,
    };
    const profileRoot = this.profileRoot(id);

    await mkdir(resolve(profileRoot, 'firefox'), { recursive: true });
    try {
      const created = this.store.createProfile(profile);
      this.store.recordEvent(
        'profile',
        'info',
        `Profile ${profile.name} was created`,
        timestamp,
      );
      return created;
    } catch (error) {
      await rm(profileRoot, { force: true, recursive: true });
      throw error;
    }
  }

  list(): Profile[] {
    return this.store.listProfiles();
  }

  get(id: string): Profile {
    return this.store.requireProfile(id);
  }

  update(id: string, input: UpdateProfileRequest): Profile {
    const updated = this.store.updateProfile(
      id,
      {
        ...(input.avatarId !== undefined ? { avatarId: input.avatarId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
      },
      this.now().toISOString(),
    );
    this.store.recordEvent('profile', 'info', `Profile ${updated.name} was updated`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const profile = this.store.requireProfile(id);
    this.store.deleteProfile(id, this.now().toISOString());
    await rm(this.profileRoot(id), { force: true, recursive: true });
    this.store.recordEvent('profile', 'warning', `Profile ${profile.name} was deleted`);
  }

  private profileRoot(id: string): string {
    const profilesRoot = resolve(this.paths.profiles);
    const target = resolve(profilesRoot, id);
    const relativeTarget = relative(profilesRoot, target);
    if (
      !relativeTarget ||
      relativeTarget.startsWith('..') ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error('Profile path escaped the configured profile directory');
    }

    return target;
  }
}
