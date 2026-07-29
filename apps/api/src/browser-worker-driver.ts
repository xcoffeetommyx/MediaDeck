import type { BrowserWorkerConfig } from '@mediadeck/config';

import { DockerEngineClient, DockerEngineError } from './docker-engine.js';
import { WorkerUnavailableError } from './domain-errors.js';

export type BrowserWorkerState =
  'starting' | 'running' | 'unhealthy' | 'stopped' | 'missing';

export type StartBrowserWorkerInput = {
  framerate: number;
  kind: 'profile' | 'guest';
  launchUrl: string;
  policyStoragePath?: string;
  sessionId: string;
  storagePath: string;
  videoBitrate: number;
};

export type BrowserWorkerMetrics = {
  cpuPercent: number | null;
  gpuDevice?: string | null;
  gpuMode?: 'software' | 'dri';
  memoryBytes: number;
  memoryLimitBytes: number;
  networkReceiveBytes: number;
  networkTransmitBytes: number;
  pids: number;
};

export type BrowserWorkerDriver = {
  getStreamTarget(sessionId: string, workerId: string): URL;
  inspect(workerId: string): Promise<BrowserWorkerState>;
  isReady(): Promise<boolean>;
  metrics(workerId: string): Promise<BrowserWorkerMetrics>;
  start(input: StartBrowserWorkerInput): Promise<{ workerId: string }>;
  stop(workerId: string): Promise<void>;
};

const imagePullTimeoutMilliseconds = 15 * 60 * 1000;

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

  metrics(): Promise<BrowserWorkerMetrics> {
    return Promise.reject(
      new WorkerUnavailableError(
        'Browser worker management is disabled in this deployment',
      ),
    );
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

function readNumber(
  object: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = object?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPullError(responseBody: string): string | undefined {
  for (const line of responseBody.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const event = parseJsonObject(line);
      const detail = readString(readObject(event, 'errorDetail'), 'message');
      const error = readString(event, 'error');
      if (detail ?? error) return detail ?? error;
    } catch {
      // Successful Docker pull streams may contain progress text from older daemons.
    }
  }

  return undefined;
}

function isDriUnavailable(error: unknown, device: string): boolean {
  if (!(error instanceof DockerEngineError)) return false;
  const message = error.message.toLowerCase();
  const referencesDevice =
    message.includes(device.toLowerCase()) || message.includes('/dev/dri');
  return (
    referencesDevice &&
    [
      'no such file',
      'error gathering device information',
      'not a device',
      'operation not permitted',
      'permission denied',
    ].some((detail) => message.includes(detail))
  );
}

function sumNetworkBytes(
  networks: Record<string, unknown> | undefined,
  key: 'rx_bytes' | 'tx_bytes',
): number {
  if (!networks) return 0;
  return Object.values(networks).reduce<number>((total, network) => {
    if (!network || typeof network !== 'object' || Array.isArray(network)) return total;
    return total + (readNumber(network as Record<string, unknown>, key) ?? 0);
  }, 0);
}

export class DockerBrowserWorkerDriver implements BrowserWorkerDriver {
  readonly #client: DockerEngineClient;
  #imagePull: Promise<void> | undefined;
  readonly #workerGpuModes = new Map<string, 'software' | 'dri'>();

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

  async start(input: StartBrowserWorkerInput): Promise<{ workerId: string }> {
    await this.ensureImageAvailable();

    if (this.config.gpuMode === 'auto') {
      try {
        return await this.startWithGpuMode(input, 'dri');
      } catch (error) {
        if (!isDriUnavailable(error, this.config.driDevice)) throw error;
        return this.startWithGpuMode(input, 'software');
      }
    }

    return this.startWithGpuMode(input, this.config.gpuMode);
  }

  private async startWithGpuMode(
    {
      framerate,
      kind,
      launchUrl,
      policyStoragePath,
      sessionId,
      storagePath,
      videoBitrate,
    }: StartBrowserWorkerInput,
    gpuMode: 'software' | 'dri',
  ): Promise<{ workerId: string }> {
    const containerName = `mediadeck-worker-${sessionId}`;
    const streamPath = `/stream/${sessionId}/`;
    const memoryBytes = this.config.memoryMegabytes * 1024 * 1024;
    const sharedMemoryBytes = this.config.sharedMemoryMegabytes * 1024 * 1024;
    const hardwareAcceleration = gpuMode === 'dri';

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
            `SELKIES_FRAMERATE=${framerate}`,
            'SELKIES_GAMEPAD_ENABLED=true|locked',
            'SELKIES_MICROPHONE_ENABLED=false|locked',
            'SELKIES_UI_SHOW_LOGO=false|locked',
            'SELKIES_UI_SHOW_SIDEBAR=false|locked',
            `SELKIES_USE_CPU=${hardwareAcceleration ? 'false' : 'true'}|locked`,
            `SELKIES_VIDEO_BITRATE=${videoBitrate}`,
            'START_DOCKER=false',
            `SUBFOLDER=${streamPath}`,
            'TITLE=MediaDeck',
            `TZ=${this.config.timezone}`,
            ...(hardwareAcceleration
              ? [
                  'AUTO_GPU=true',
                  `DRI_NODE=${this.config.driDevice}`,
                  `DRINODE=${this.config.driDevice}`,
                  `SELKIES_DRI_NODE=${this.config.driDevice}`,
                ]
              : []),
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
            ...(hardwareAcceleration
              ? {
                  Devices: [
                    {
                      CgroupPermissions: 'rwm',
                      PathInContainer: this.config.driDevice,
                      PathOnHost: this.config.driDevice,
                    },
                  ],
                }
              : {}),
            Memory: memoryBytes,
            MemorySwap: memoryBytes,
            Mounts: [
              {
                Source: this.config.dataVolumeName,
                Target: '/config',
                Type: 'volume',
                VolumeOptions: {
                  Subpath: storagePath,
                },
              },
              ...(policyStoragePath
                ? [
                    {
                      ReadOnly: true,
                      Source: this.config.dataVolumeName,
                      Target: '/etc/firefox/policies',
                      Type: 'volume',
                      VolumeOptions: {
                        Subpath: policyStoragePath,
                      },
                    },
                  ]
                : []),
            ],
            NetworkMode: this.config.network,
            NanoCpus: Math.round(this.config.cpus * 1_000_000_000),
            PidsLimit: this.config.pidsLimit,
            RestartPolicy: {
              Name: 'no',
            },
            SecurityOpt: ['no-new-privileges:true'],
            ShmSize: sharedMemoryBytes,
          },
          Image: this.config.image,
          Labels: {
            'io.mediadeck.browser.kind': 'worker',
            'io.mediadeck.gpu.mode': gpuMode,
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
      await this.stop(workerId).catch(() => undefined);
      throw error;
    }

    this.#workerGpuModes.set(workerId, gpuMode);
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
    const labels = readObject(readObject(response, 'Config') ?? {}, 'Labels');
    const gpuMode = readString(labels, 'io.mediadeck.gpu.mode');
    if (gpuMode === 'software' || gpuMode === 'dri') {
      this.#workerGpuModes.set(workerId, gpuMode);
    }
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

  async metrics(workerId: string): Promise<BrowserWorkerMetrics> {
    const response = parseJsonObject(
      await this.#client.request({
        path: `/containers/${encodeURIComponent(workerId)}/stats?stream=false&one-shot=true`,
      }),
    );
    const cpu = readObject(response, 'cpu_stats');
    const previousCpu = readObject(response, 'precpu_stats');
    const cpuUsage = readObject(cpu ?? {}, 'cpu_usage');
    const previousCpuUsage = readObject(previousCpu ?? {}, 'cpu_usage');
    const cpuDelta =
      (readNumber(cpuUsage, 'total_usage') ?? 0) -
      (readNumber(previousCpuUsage, 'total_usage') ?? 0);
    const systemDelta =
      (readNumber(cpu, 'system_cpu_usage') ?? 0) -
      (readNumber(previousCpu, 'system_cpu_usage') ?? 0);
    const onlineCpus =
      readNumber(cpu, 'online_cpus') ??
      (Array.isArray(cpuUsage?.percpu_usage) ? cpuUsage.percpu_usage.length : 1);
    const memory = readObject(response, 'memory_stats');
    const networks = readObject(response, 'networks');
    const pids = readObject(response, 'pids_stats');

    return {
      cpuPercent:
        cpuDelta > 0 && systemDelta > 0
          ? (cpuDelta / systemDelta) * onlineCpus * 100
          : null,
      gpuDevice:
        this.#workerGpuModes.get(workerId) === 'dri' ? this.config.driDevice : null,
      gpuMode:
        this.#workerGpuModes.get(workerId) ??
        (this.config.gpuMode === 'software' ? 'software' : 'dri'),
      memoryBytes: readNumber(memory, 'usage') ?? 0,
      memoryLimitBytes: readNumber(memory, 'limit') ?? 0,
      networkReceiveBytes: sumNetworkBytes(networks, 'rx_bytes'),
      networkTransmitBytes: sumNetworkBytes(networks, 'tx_bytes'),
      pids: readNumber(pids, 'current') ?? 0,
    };
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
        this.#workerGpuModes.delete(workerId);
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

  private async ensureImageAvailable(): Promise<void> {
    try {
      await this.#client.request({
        path: `/images/${encodeURIComponent(this.config.image)}/json`,
      });
      return;
    } catch (error) {
      if (!(error instanceof DockerEngineError) || error.statusCode !== 404) {
        throw error;
      }
    }

    this.#imagePull ??= this.pullImage().finally(() => {
      this.#imagePull = undefined;
    });
    await this.#imagePull;
  }

  private async pullImage(): Promise<void> {
    const responseBody = await this.#client.request({
      expectedStatuses: [200],
      method: 'POST',
      path: `/images/create?fromImage=${encodeURIComponent(this.config.image)}`,
      timeoutMilliseconds: imagePullTimeoutMilliseconds,
    });
    const pullError = readPullError(responseBody);
    if (pullError) {
      throw new WorkerUnavailableError(
        `Docker Engine could not pull the browser worker image: ${pullError}`,
      );
    }

    await this.#client.request({
      path: `/images/${encodeURIComponent(this.config.image)}/json`,
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
