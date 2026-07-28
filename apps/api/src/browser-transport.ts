import type {
  BrowserWorkerCapabilities,
  BrowserWorkerHealthResponse,
} from '@mediadeck/contracts';

export type BrowserTransportProbe = {
  check(): Promise<BrowserWorkerHealthResponse>;
};

type HttpBrowserTransportProbeOptions = {
  fetchImplementation?: typeof fetch;
  timeoutMilliseconds?: number;
  workerUrl?: string | undefined;
};

const capabilities: BrowserWorkerCapabilities = {
  audio: true,
  gamepad: true,
  keyboard: true,
  pointer: true,
  reconnect: true,
  touch: true,
};

export class HttpBrowserTransportProbe implements BrowserTransportProbe {
  readonly #fetch: typeof fetch;
  readonly #timeoutMilliseconds: number;
  readonly #workerUrl: string | undefined;

  constructor({
    fetchImplementation = fetch,
    timeoutMilliseconds = 3_000,
    workerUrl,
  }: HttpBrowserTransportProbeOptions) {
    this.#fetch = fetchImplementation;
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#workerUrl = workerUrl;
  }

  async check(): Promise<BrowserWorkerHealthResponse> {
    const checkedAt = new Date().toISOString();
    const transport = {
      mode: 'websocket' as const,
      provider: 'selkies',
    };

    if (!this.#workerUrl) {
      return {
        capabilities,
        checkedAt,
        detail: 'BROWSER_WORKER_URL is not configured',
        status: 'unconfigured',
        transport,
      };
    }

    try {
      const response = await this.#fetch(new URL('/', this.#workerUrl), {
        signal: AbortSignal.timeout(this.#timeoutMilliseconds),
      });

      if (!response.ok) {
        return {
          capabilities,
          checkedAt,
          detail: `Browser worker returned HTTP ${response.status}`,
          status: 'offline',
          transport,
        };
      }

      return {
        capabilities,
        checkedAt,
        status: 'online',
        transport,
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Browser worker probe failed';

      return {
        capabilities,
        checkedAt,
        detail,
        status: 'offline',
        transport,
      };
    }
  }
}
