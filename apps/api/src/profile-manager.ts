import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  CreateProfileRequest,
  Profile,
  UpdateProfileRequest,
} from '@mediadeck/contracts';
import type { StoragePaths } from '@mediadeck/config';

import { OperationCoordinator } from './operation-coordinator.js';
import { MediaDeckStore } from './store.js';

export class ProfileManager {
  constructor(
    private readonly store: MediaDeckStore,
    private readonly paths: StoragePaths,
    private readonly now: () => Date = () => new Date(),
    private readonly operations: OperationCoordinator = new OperationCoordinator(),
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async create(input: CreateProfileRequest): Promise<Profile> {
    return this.operations.run(async () => {
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

      await mkdir(resolve(profileRoot, 'brave-origin'), { recursive: true });
      try {
        const created = this.store.createProfile(profile);
        this.recordEventSafely(
          'info',
          `Profile ${profile.name} was created`,
          timestamp,
        );
        return created;
      } catch (error) {
        await rm(profileRoot, { force: true, recursive: true }).catch(this.onError);
        throw error;
      }
    });
  }

  list(): Profile[] {
    return this.store.listProfiles();
  }

  get(id: string): Profile {
    return this.store.requireProfile(id);
  }

  update(id: string, input: UpdateProfileRequest): Promise<Profile> {
    return this.operations.run(() => {
      const updated = this.store.updateProfile(
        id,
        {
          ...(input.avatarId !== undefined ? { avatarId: input.avatarId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
        },
        this.now().toISOString(),
      );
      this.recordEventSafely('info', `Profile ${updated.name} was updated`);
      return Promise.resolve(updated);
    });
  }

  async delete(id: string): Promise<void> {
    await this.operations.run(async () => {
      const profile = this.store.requireProfile(id);
      this.store.deleteProfile(id, this.now().toISOString());
      await rm(this.profileRoot(id), { force: true, recursive: true }).catch(
        this.onError,
      );
      this.recordEventSafely('warning', `Profile ${profile.name} was deleted`);
    });
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

  private recordEventSafely(
    level: 'error' | 'info' | 'warning',
    message: string,
    createdAt = this.now().toISOString(),
  ): void {
    try {
      this.store.recordEvent('profile', level, message, createdAt);
    } catch (error) {
      this.onError(error);
    }
  }
}
