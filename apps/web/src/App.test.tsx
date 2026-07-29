import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { createSessionId } from './session-identity';

const profile = {
  avatarId: 'ocean',
  createdAt: '2026-07-28T12:00:00.000Z',
  id: '8417990e-73dd-4d70-894f-d1bc1425d7de',
  name: 'Tommy',
  updatedAt: '2026-07-28T12:00:00.000Z',
};

const runningSession = {
  applicationId: 'youtube',
  createdAt: '2026-07-28T12:00:00.000Z',
  endedAt: null,
  failureReason: null,
  id: '2abfc294-b100-48e1-93ad-bd34718e9a97',
  kind: 'profile',
  lastSeenAt: '2026-07-28T12:00:01.000Z',
  profileId: profile.id,
  status: 'running',
  streamUrl: '/stream/2abfc294-b100-48e1-93ad-bd34718e9a97/',
  updatedAt: '2026-07-28T12:00:01.000Z',
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function mockApi(
  profiles = [profile],
  capacity = {
    activeSessions: 0,
    availableSlots: 1,
    atCapacity: false,
    idleTimeoutSeconds: 1800,
    maxSessions: 1,
  },
) {
  let extensions: {
    enabled: boolean;
    id: string;
    installedAt: string;
    name: string;
    profileId: string;
    updatedAt: string;
  }[] = [];
  let settings = {
    automaticUpdateChecks: true,
    backupRetentionCount: 5,
    disableAv1Playback: false,
    streamQualityPreset: 'balanced',
    streamResolutionPreset: 'full-hd',
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith('/api/v1/health')) {
      return Promise.resolve(
        jsonResponse({
          service: 'mediadeck-api',
          status: 'ok',
          timestamp: '2026-07-28T12:00:00.000Z',
          uptimeSeconds: 10,
          version: '0.1.0-test',
        }),
      );
    }
    if (url.endsWith('/api/v1/browser-worker/health')) {
      return Promise.resolve(
        jsonResponse({
          capabilities: {
            audio: true,
            gamepad: false,
            keyboard: true,
            pointer: true,
            reconnect: true,
            touch: true,
          },
          checkedAt: '2026-07-28T12:00:00.000Z',
          status: 'online',
          transport: { mode: 'websocket', provider: 'selkies' },
        }),
      );
    }
    if (url.endsWith('/api/v1/capacity')) {
      return Promise.resolve(jsonResponse(capacity));
    }
    if (url.endsWith('/api/v1/admin/status')) {
      return Promise.resolve(
        jsonResponse({
          authenticated: true,
          expiresAt: null,
          pinEnabled: false,
        }),
      );
    }
    if (url.endsWith('/api/v1/settings')) {
      if (init?.method === 'PATCH' && typeof init.body === 'string') {
        settings = {
          ...settings,
          ...(JSON.parse(init.body) as Partial<typeof settings>),
        };
      }
      return Promise.resolve(jsonResponse(settings));
    }
    if (url.endsWith('/api/v1/operations/diagnostics')) {
      return Promise.resolve(
        jsonResponse({
          activeSessions: 0,
          checkedAt: '2026-07-28T12:00:00.000Z',
          database: { healthy: true, schemaVersion: 4, sizeBytes: 4096 },
          failedSessions: 0,
          lastBackupAt: null,
          profiles: profiles.length,
          status: 'healthy',
          storage: { availableBytes: 4_000_000_000, writable: true },
          uptimeSeconds: 10,
          version: '0.1.0-test',
          worker: { detail: null, status: 'online' },
        }),
      );
    }
    if (url.includes('/api/v1/operations/logs')) {
      return Promise.resolve(jsonResponse({ events: [] }));
    }
    if (url.endsWith('/api/v1/operations/resources')) {
      return Promise.resolve(
        jsonResponse({
          capacity,
          limitsPerWorker: {
            cpus: 2,
            memoryBytes: 2_147_483_648,
            pids: 512,
            sharedMemoryBytes: 1_073_741_824,
            videoBitrateMbps: 12,
          },
          sampledAt: '2026-07-28T12:00:00.000Z',
          sessions: [],
        }),
      );
    }
    if (url.endsWith('/api/v1/backups')) {
      return Promise.resolve(jsonResponse({ backups: [] }));
    }
    if (url.endsWith('/api/v1/updates/status')) {
      return Promise.resolve(
        jsonResponse({
          approvedAt: null,
          backupId: null,
          checkedAt: null,
          installedVersion: '0.1.0-test',
          manifestConfigured: false,
          message: 'Set MEDIADECK_UPDATE_MANIFEST_URL to enable release checks.',
          release: null,
          state: 'unconfigured',
        }),
      );
    }
    if (url.endsWith(`/api/v1/profiles/${profile.id}/extensions`)) {
      if (init?.method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as { id: string; name: string };
        const extension = {
          enabled: true,
          id: body.id,
          installedAt: '2026-07-28T12:00:00.000Z',
          name: body.name,
          profileId: profile.id,
          updatedAt: '2026-07-28T12:00:00.000Z',
        };
        extensions = [extension];
        return Promise.resolve(jsonResponse(extension, 201));
      }
      return Promise.resolve(jsonResponse({ extensions }));
    }
    if (url.endsWith('/api/v1/profiles') && init?.method === 'POST') {
      if (typeof init.body !== 'string') {
        throw new TypeError('Expected a JSON request body');
      }
      const body = JSON.parse(init.body) as {
        avatarId: string;
        name: string;
      };
      return Promise.resolve(
        jsonResponse(
          {
            ...profile,
            avatarId: body.avatarId,
            id: '3a641074-3901-480f-a2ce-b732c6e03f06',
            name: body.name,
          },
          201,
        ),
      );
    }
    if (url.endsWith('/api/v1/profiles')) {
      return Promise.resolve(jsonResponse({ profiles }));
    }
    return Promise.resolve(jsonResponse({ message: 'Not found' }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('MediaDeck application shell', () => {
  it('creates a valid session ID when randomUUID is unavailable over LAN HTTP', () => {
    const randomSource = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([
          0x2a, 0xbf, 0xc2, 0x94, 0xb1, 0x00, 0x48, 0xe1, 0x93, 0xad, 0xbd, 0x34, 0x71,
          0x8e, 0x9a, 0x97,
        ]);
        return bytes;
      },
    } as unknown as Crypto;

    expect(createSessionId(randomSource)).toBe('2abfc294-b100-48e1-93ad-bd34718e9a97');
  });

  it('loads real profiles and enters the home screen', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Who’s watching?' }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Tommy/ }));

    expect(
      screen.getByRole('heading', { name: 'What do you want to watch?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Welcome, Tommy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /YouTube/ })).toBeInTheDocument();
    expect(screen.getByText('MediaDeck online')).toBeInTheDocument();
  });

  it('creates a profile and selects it immediately', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Add profile/ }));
    await user.type(screen.getByLabelText('Profile name'), 'Lily');
    await user.click(screen.getByRole('button', { name: 'Use violet avatar' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Create profile' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText('Welcome, Lily')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses directional keys and consistent back navigation', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);

    const profileButton = await screen.findByRole('button', { name: /Tommy/ });
    await waitFor(() => expect(profileButton).toHaveFocus());
    await user.click(profileButton);

    const youtube = screen.getByRole('button', { name: /YouTube/ });
    await waitFor(() => expect(youtube).toHaveFocus());
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /Settings/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.getByRole('heading', { name: 'What do you want to watch?' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(
      screen.getByRole('heading', { name: 'Who’s watching?' }),
    ).toBeInTheDocument();
  });

  it('loads the Stage 6 operational settings screen', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: /Settings/ }));

    expect(
      await screen.findByRole('heading', { name: 'Administrator access' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Healthy')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Create backup' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Run recovery check' }),
    ).toBeInTheDocument();
  });

  it('changes the stream quality preset from settings', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(
      await screen.findByRole('button', {
        name: /^Data saver/i,
      }),
    );

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith('/api/v1/settings') &&
          init?.method === 'PATCH' &&
          init.body === JSON.stringify({ streamQualityPreset: 'data-saver' }),
      ),
    ).toBe(true);
    expect(
      await screen.findByText(/Data saver stream quality saved/i),
    ).toBeInTheDocument();
  });

  it('changes the stream resolution preset from settings', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(
      await screen.findByRole('button', {
        name: /720p HD/i,
      }),
    );

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith('/api/v1/settings') &&
          init?.method === 'PATCH' &&
          init.body === JSON.stringify({ streamResolutionPreset: 'hd' }),
      ),
    ).toBe(true);
    expect(await screen.findByText(/720p HD resolution saved/i)).toBeInTheDocument();
  });

  it('adds a trusted Chrome Web Store extension to the selected profile', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.type(await screen.findByLabelText('Display name'), 'SponsorBlock');
    await user.type(
      screen.getByLabelText('Chrome Web Store URL or extension ID'),
      'https://chromewebstore.google.com/detail/sponsorblock/mnjggcdmjocbbbhaepdhchncahnbgone',
    );
    await user.click(screen.getByRole('button', { name: 'Add extension' }));

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith(`/api/v1/profiles/${profile.id}/extensions`) &&
          init?.method === 'POST' &&
          init.body ===
            JSON.stringify({
              id: 'mnjggcdmjocbbbhaepdhchncahnbgone',
              name: 'SponsorBlock',
            }),
      ),
    ).toBe(true);
    expect(
      await screen.findByText(/will install when Tommy launches/i),
    ).toBeInTheDocument();
  });

  it('enables older-hardware AV1 compatibility from settings', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(
      await screen.findByRole('button', {
        name: 'Enable',
      }),
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestUrl(input).endsWith('/api/v1/settings') &&
            init?.method === 'PATCH' &&
            init.body === JSON.stringify({ disableAv1Playback: true }),
        ),
      ).toBe(true),
    );
  });

  it('keeps Guest available when profile loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (requestUrl(input).endsWith('/api/v1/profiles')) {
          return Promise.resolve(
            jsonResponse({ message: 'Database unavailable' }, 503),
          );
        }
        return Promise.reject(new Error('offline'));
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    await user.click(screen.getByRole('button', { name: /Guest/ }));
    expect(screen.getByText('Welcome, Guest')).toBeInTheDocument();
  });

  it('has no automatically detectable accessibility violations', async () => {
    mockApi();
    const { container } = render(<App />);

    await screen.findByRole('button', { name: 'Tommy profile' });
    const results = await axe.run(container, {
      rules: {
        // axe documents that color contrast is unavailable in JSDOM.
        'color-contrast': { enabled: false },
      },
    });

    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.flatMap((node) => node.target),
      })),
    ).toEqual([]);
  });

  it('keeps keyboard focus inside an open dialog', async () => {
    mockApi([]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Add profile' }));
    const close = screen.getByRole('button', { name: 'Close Create profile' });
    const create = screen.getByRole('button', { name: 'Create profile' });

    create.focus();
    fireEvent.keyDown(create, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(create).toHaveFocus();
  });

  it('launches and releases a profile-scoped YouTube session', async () => {
    const fetchMock = mockApi();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/v1/applications/youtube/launch')) {
        return Promise.resolve(jsonResponse(runningSession));
      }
      if (url.endsWith(`/api/v1/sessions/${runningSession.id}/stop`)) {
        return Promise.resolve(
          jsonResponse({
            ...runningSession,
            endedAt: '2026-07-28T12:10:00.000Z',
            status: 'stopped',
          }),
        );
      }
      if (url.endsWith('/api/v1/health')) {
        return Promise.resolve(
          jsonResponse({
            service: 'mediadeck-api',
            status: 'ok',
            timestamp: '2026-07-28T12:00:00.000Z',
            uptimeSeconds: 10,
            version: '0.1.0-test',
          }),
        );
      }
      if (url.endsWith('/api/v1/browser-worker/health')) {
        return Promise.resolve(
          jsonResponse({
            capabilities: {
              audio: true,
              gamepad: true,
              keyboard: true,
              pointer: true,
              reconnect: true,
              touch: true,
            },
            checkedAt: '2026-07-28T12:00:00.000Z',
            status: 'online',
            transport: { mode: 'websocket', provider: 'selkies' },
          }),
        );
      }
      if (url.endsWith('/api/v1/profiles')) {
        return Promise.resolve(jsonResponse({ profiles: [profile] }));
      }
      return Promise.resolve(jsonResponse({ message: 'Not found' }, 404));
    });

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: 'Launch YouTube' }));

    const streamFrame = await screen.findByTitle<HTMLIFrameElement>(
      'YouTube Brave stream for Tommy',
    );
    expect(streamFrame).toHaveAttribute('src', `${runningSession.streamUrl}?viewer=0`);
    const launchCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith('/api/v1/applications/youtube/launch'),
    );
    expect(launchCall?.[1]?.body).toEqual(
      expect.stringContaining(`"profileId":"${profile.id}"`),
    );

    const frameDocument = streamFrame.contentDocument!;
    frameDocument.open();
    frameDocument.write('<!doctype html><html><body></body></html>');
    frameDocument.close();
    const keyboardInput = frameDocument.createElement('input');
    keyboardInput.id = 'keyboard-input-assist';
    keyboardInput.setAttribute('aria-hidden', 'true');
    frameDocument.body.append(keyboardInput);
    fireEvent.click(
      screen.getByRole('button', { hidden: true, name: 'Open mobile keyboard' }),
    );
    expect(frameDocument.activeElement).toBe(keyboardInput);
    expect(keyboardInput).not.toHaveAttribute('aria-hidden');

    await user.click(screen.getByRole('button', { name: /MediaDeck/ }));
    expect(
      await screen.findByRole('heading', { name: 'What do you want to watch?' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/sessions/${runningSession.id}/stop`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows an actionable YouTube launch failure', async () => {
    const fetchMock = mockApi();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/v1/applications/youtube/launch')) {
        return Promise.resolve(
          jsonResponse({ message: 'Browser capacity is full' }, 429),
        );
      }
      if (url.endsWith('/api/v1/profiles')) {
        return Promise.resolve(jsonResponse({ profiles: [profile] }));
      }
      if (url.endsWith('/api/v1/health')) {
        return Promise.resolve(
          jsonResponse({
            service: 'mediadeck-api',
            status: 'ok',
            timestamp: '2026-07-28T12:00:00.000Z',
            uptimeSeconds: 10,
            version: '0.1.0-test',
          }),
        );
      }
      return Promise.reject(new Error('offline'));
    });

    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: 'Launch YouTube' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Browser capacity is full',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('prevents a new launch when host stream capacity is full', async () => {
    mockApi([profile], {
      activeSessions: 2,
      availableSlots: 0,
      atCapacity: true,
      idleTimeoutSeconds: 1800,
      maxSessions: 2,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    const launch = screen.getByRole('button', { name: 'Launch YouTube' });
    expect(launch).toBeDisabled();
    expect(screen.getByText('All streams busy')).toBeInTheDocument();
    expect(screen.getByText(/running 2 of 2 streams/)).toBeInTheDocument();
  });
});
