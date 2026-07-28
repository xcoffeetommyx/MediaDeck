import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MediaDeck landing page', () => {
  it('introduces the product and reports a healthy API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            service: 'mediadeck-api',
            status: 'ok',
            timestamp: '2026-07-28T12:00:00.000Z',
            uptimeSeconds: 10,
            version: '0.1.0-test',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
      ),
    );

    render(<App />);

    expect(screen.getByRole('heading', { name: /your media/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('Foundation online')).toHaveLength(2);
    });
    expect(screen.getByText('v0.1.0-test')).toBeInTheDocument();
  });

  it('shows an unavailable state when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Service unavailable')).toHaveLength(2);
    });
  });
});
