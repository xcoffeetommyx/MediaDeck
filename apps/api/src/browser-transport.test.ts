import { browserWorkerHealthResponseSchema } from '@mediadeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import { HttpBrowserTransportProbe } from './browser-transport.js';

describe('HTTP browser transport probe', () => {
  it('reports an unconfigured worker without making a request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const probe = new HttpBrowserTransportProbe({ fetchImplementation });

    const result = await probe.check();

    expect(browserWorkerHealthResponseSchema.parse(result).status).toBe('unconfigured');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('reports a reachable worker as online', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 200 }));
    const probe = new HttpBrowserTransportProbe({
      fetchImplementation,
      workerUrl: 'http://browser-worker:3000',
    });

    const result = await probe.check();

    expect(result).toMatchObject({
      status: 'online',
      transport: {
        mode: 'websocket',
        provider: 'selkies',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0]!;
    expect(url).toEqual(new URL('http://browser-worker:3000/'));
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports an unsuccessful response as offline', async () => {
    const probe = new HttpBrowserTransportProbe({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('', { status: 503 })),
      workerUrl: 'http://browser-worker:3000',
    });

    await expect(probe.check()).resolves.toMatchObject({
      detail: 'Browser worker returned HTTP 503',
      status: 'offline',
    });
  });

  it('reports a connection error as offline', async () => {
    const probe = new HttpBrowserTransportProbe({
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('connection refused')),
      workerUrl: 'http://browser-worker:3000',
    });

    await expect(probe.check()).resolves.toMatchObject({
      detail: 'connection refused',
      status: 'offline',
    });
  });
});
