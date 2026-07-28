import type { MediaApplication, MediaApplicationId } from '@mediadeck/contracts';

import { NotFoundError } from './domain-errors.js';

export type MediaApplicationDefinition = MediaApplication & {
  launchUrl: string;
};

export class ApplicationRegistry {
  readonly #applications: Map<MediaApplicationId, MediaApplicationDefinition>;

  constructor(youtubeLaunchUrl: string) {
    const youtube: MediaApplicationDefinition = {
      available: true,
      description:
        'Subscriptions, playlists, recommendations, and playback in isolated Firefox.',
      displayName: 'YouTube',
      id: 'youtube',
      launchUrl: youtubeLaunchUrl,
    };

    this.#applications = new Map([[youtube.id, youtube]]);
  }

  list(): MediaApplication[] {
    return [...this.#applications.values()].map((application) => ({
      available: application.available,
      description: application.description,
      displayName: application.displayName,
      id: application.id,
    }));
  }

  require(id: MediaApplicationId): MediaApplicationDefinition {
    const application = this.#applications.get(id);
    if (!application?.available) {
      throw new NotFoundError(`Application ${id} is not available`);
    }

    return application;
  }
}
