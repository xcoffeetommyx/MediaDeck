import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

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
  profileAddons: {
    enabled: boolean;
    id: string;
    installedAt: string;
    maxFirefoxVersion: string | null;
    minFirefoxVersion: string | null;
    name: string;
    permissions: string[];
    profileId: string;
    sha256: string;
    source: 'upload' | 'watched';
    updatedAt: string;
    version: string;
  }[] = [],
) {
  let settings = {
    automaticUpdateChecks: true,
    backupRetentionCount: 5,
    streamQualityPreset: 'balanced',
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
    if (
      url.endsWith(`/api/v1/profiles/${profile.id}/addons/stage8%40example.test`) &&
      init?.method === 'PATCH'
    ) {
      return Promise.resolve(jsonResponse({ ...profileAddons[0], enabled: false }));
    }
    if (url.endsWith(`/api/v1/profiles/${profile.id}/addons`)) {
      return Promise.resolve(jsonResponse({ addons: profileAddons }));
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
        name: /Data saver/i,
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

  it('shows and disables a managed Firefox add-on for the selected profile', async () => {
    const addon = {
      enabled: true,
      id: 'stage8@example.test',
      installedAt: '2026-07-28T12:00:00.000Z',
      maxFirefoxVersion: null,
      minFirefoxVersion: '109.0',
      name: 'Stage Eight',
      permissions: ['storage'],
      profileId: profile.id,
      sha256: 'a'.repeat(64),
      source: 'upload' as const,
      updatedAt: '2026-07-28T12:00:00.000Z',
      version: '1.0.0',
    };
    const fetchMock = mockApi(
      [profile],
      {
        activeSessions: 0,
        availableSlots: 1,
        atCapacity: false,
        idleTimeoutSeconds: 1800,
        maxSessions: 1,
      },
      [addon],
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Tommy/ }));
    await user.click(screen.getByRole('button', { name: /Settings/ }));
    expect(await screen.findByText('Stage Eight')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/profiles/${profile.id}/addons/${encodeURIComponent(addon.id)}`,
        expect.objectContaining({
          body: JSON.stringify({ enabled: false }),
          method: 'PATCH',
        }),
      ),
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

    expect(
      await screen.findByTitle('YouTube Firefox stream for Tommy'),
    ).toHaveAttribute('src', `${runningSession.streamUrl}?viewer=0`);
    const launchCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith('/api/v1/applications/youtube/launch'),
    );
    expect(launchCall?.[1]?.body).toEqual(
      expect.stringContaining(`"profileId":"${profile.id}"`),
    );

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
