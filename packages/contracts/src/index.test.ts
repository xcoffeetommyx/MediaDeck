import { describe, expect, it } from 'vitest';

import { healthResponseSchema, publicConfigResponseSchema } from './index.js';

describe('API contracts', () => {
  it('accepts a valid health response', () => {
    const response = healthResponseSchema.parse({
      service: 'mediadeck-api',
      status: 'ok',
      timestamp: '2026-07-28T12:00:00.000Z',
      uptimeSeconds: 42,
      version: '0.1.0',
    });

    expect(response.status).toBe('ok');
  });

  it('rejects an invalid public environment', () => {
    expect(() =>
      publicConfigResponseSchema.parse({
        appName: 'MediaDeck',
        environment: 'staging',
        version: '0.1.0',
      }),
    ).toThrow();
  });
});
