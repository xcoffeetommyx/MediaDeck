import type { BrowserWorkerConfig } from '@mediadeck/config';

import { DockerEngineClient, DockerEngineError } from './docker-engine.js';
import { WorkerUnavailableError } from './domain-errors.js';

export type BrowserWorkerState =
  'starting' | 'running' | 'unhealthy' | 'stopped' | 'missing';

export type StartBrowserWorkerInput = {
  kind: 'profile' | 'guest';
  launchUrl: string;
  sessionId: string;
  storagePath: string;
};

export type BrowserWorkerDriver = {
  getStreamTarget(sessionId: string, workerId: string): URL;
  inspect(workerId: string): Promise<BrowserWorkerState>;
  isReady(): Promise<boolean>;
  start(input: StartBrowserWorkerInput): Promise<{ workerId: string }>;
  stop(workerId: string): Promise<void>;
};

export class DisabledBrowserWorkerDriver implements BrowserWorkerDriver {
  getStreamTarget(): URL {
    throw new WorkerUnavailableError(
      'Browser worker management is disabled in this deployment',
    );
  }

  inspect(): Promise<BrowserWorkerState> {
    return Promise.resolve('missing');
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(false);
  }

  start(): Promise<{ workerId: string }> {
    return Promise.reject(
      new WorkerUnavailableError(
        'Browser worker management is disabled in this deployment',
      ),
    );
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Docker Engine returned an unexpected response');
  }

  return parsed as Record<string, unknown>;
}

function readObject(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = object[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readString(
  object: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = object?.[key];
  return typeof value === 'string' ? value : undefined;
}

export class DockerBrowserWorkerDriver implements BrowserWorkerDriver {
  readonly #client: DockerEngineClient;

  constructor(private readonly config: BrowserWorkerConfig) {
    this.#client = new DockerEngineClient(config.dockerSocketPath);
  }

  async isReady(): Promise<boolean> {
    try {
      await this.#client.request({
        expectedStatuses: [200],
        path: '/_ping',
      });
      return true;
    } catch {
      return false;
    }
  }

  async start({
    kind,
    launchUrl,
    sessionId,
    storagePath,
  }: StartBrowserWorkerInput): Promise<{ workerId: string }> {
    const containerName = `mediadeck-worker-${sessionId}`;
    const streamPath = `/stream/${sessionId}/`;

    await this.removeByName(containerName);

    const response = parseJsonObject(
      await this.#client.request({
        body: {
          Env: [
            'HARDEN_DESKTOP=true',
            'HARDEN_OPENBOX=true',
            `FIREFOX_CLI=--kiosk ${launchUrl}`,
            'NO_DECOR=true',
            `PGID=${this.config.pgid}`,
            'PIXELFLUX_WAYLAND=true',
            `PUID=${this.config.puid}`,
            'SELKIES_AUDIO_ENABLED=true|locked',
            'SELKIES_CLIPBOARD_ENABLED=false|locked',
            'SELKIES_COMMAND_ENABLED=false|locked',
            'SELKIES_ENABLE_SHARING=false|locked',
            'SELKIES_ENCODER=x264enc',
            'SELKIES_FILE_TRANSFERS=download',
            `SELKIES_FRAMERATE=${this.config.framerate}`,
            'SELKIES_GAMEPAD_ENABLED=true|locked',
            'SELKIES_MICROPHONE_ENABLED=false|locked',
            'SELKIES_UI_SHOW_LOGO=false|locked',
            'SELKIES_UI_SHOW_SIDEBAR=false|locked',
            'SELKIES_USE_CPU=true|locked',
            `SELKIES_VIDEO_BITRATE=${this.config.videoBitrate}`,
            'START_DOCKER=false',
            `SUBFOLDER=${streamPath}`,
            'TITLE=MediaDeck',
            `TZ=${this.config.timezone}`,
          ],
          ExposedPorts: {
            '3000/tcp': {},
          },
          Healthcheck: {
            Interval: 15_000_000_000,
            Retries: 5,
            StartPeriod: 45_000_000_000,
            Test: [
              'CMD',
              'curl',
              '--fail',
              '--silent',
              '--show-error',
              `http://127.0.0.1:3000${streamPath}`,
            ],
            Timeout: 5_000_000_000,
          },
          HostConfig: {
            Mounts: [
              {
                Source: this.config.dataVolumeName,
                Target: '/config',
                Type: 'volume',
                VolumeOptions: {
                  Subpath: storagePath,
                },
              },
            ],
            NetworkMode: this.config.network,
            RestartPolicy: {
              Name: 'no',
            },
            SecurityOpt: ['no-new-privileges:true'],
            ShmSize: 1_073_741_824,
          },
          Image: this.config.image,
          Labels: {
            'io.mediadeck.browser.kind': 'worker',
            'io.mediadeck.profile.kind': kind,
            'io.mediadeck.session.id': sessionId,
          },
        },
        expectedStatuses: [201],
        method: 'POST',
        path: `/containers/create?name=${encodeURIComponent(containerName)}`,
      }),
    );
    const workerId = readString(response, 'Id');
    if (!workerId) {
      throw new Error('Docker Engine did not return a browser worker ID');
    }

    try {
      await this.#client.request({
        expectedStatuses: [204, 304],
        method: 'POST',
        path: `/containers/${encodeURIComponent(workerId)}/start`,
      });
    } catch (error) {
      await this.stop(workerId);
      throw error;
    }

    return { workerId };
  }

  async inspect(workerId: string): Promise<BrowserWorkerState> {
    let response: Record<string, unknown>;
    try {
      response = parseJsonObject(
        await this.#client.request({
          path: `/containers/${encodeURIComponent(workerId)}/json`,
        }),
      );
    } catch (error) {
      if (error instanceof DockerEngineError && error.statusCode === 404) {
        return 'missing';
      }
      throw error;
    }

    const state = readObject(response, 'State');
    const status = readString(state, 'Status');
    const health = readString(readObject(state ?? {}, 'Health'), 'Status');

    if (status === 'running') {
      if (health === 'healthy') {
        return 'running';
      }
      if (health === 'unhealthy') {
        return 'unhealthy';
      }
      return 'starting';
    }

    return status ? 'stopped' : 'missing';
  }

  getStreamTarget(sessionId: string): URL {
    return new URL(`http://mediadeck-worker-${sessionId}:3000`);
  }

  async stop(workerId: string): Promise<void> {
    try {
      await this.#client.request({
        expectedStatuses: [204, 304, 404],
        method: 'POST',
        path: `/containers/${encodeURIComponent(workerId)}/stop?t=10`,
      });
    } catch {
      // A forced removal below is still required when graceful stop fails.
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await this.#client.request({
          expectedStatuses: [204, 404],
          method: 'DELETE',
          path: `/containers/${encodeURIComponent(workerId)}?force=true`,
        });
        return;
      } catch (error) {
        if (
          !(error instanceof DockerEngineError) ||
          error.statusCode !== 409 ||
          attempt === 4
        ) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  private async removeByName(containerName: string): Promise<void> {
    await this.#client.request({
      expectedStatuses: [204, 404],
      method: 'DELETE',
      path: `/containers/${encodeURIComponent(containerName)}?force=true`,
    });
  }
}

export function createBrowserWorkerDriver(
  config: BrowserWorkerConfig,
): BrowserWorkerDriver {
  return config.driver === 'docker'
    ? new DockerBrowserWorkerDriver(config)
    : new DisabledBrowserWorkerDriver();
}
