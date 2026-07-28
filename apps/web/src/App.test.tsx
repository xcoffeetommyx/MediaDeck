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

function mockApi(profiles = [profile]) {
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
});
