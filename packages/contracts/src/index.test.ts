import { describe, expect, it } from 'vitest';

import {
  administratorSettingsSchema,
  browserSessionSchema,
  browserWorkerHealthResponseSchema,
  createBrowserSessionRequestSchema,
  createProfileRequestSchema,
  healthResponseSchema,
  profileSchema,
  publicConfigResponseSchema,
  updateManifestSchema,
  updateProfileRequestSchema,
} from './index.js';

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

  it('accepts a transport-neutral browser worker health response', () => {
    const response = browserWorkerHealthResponseSchema.parse({
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
      transport: {
        mode: 'websocket',
        provider: 'selkies',
      },
    });

    expect(response.transport).toEqual({
      mode: 'websocket',
      provider: 'selkies',
    });
  });

  it('rejects an unknown browser transport mode', () => {
    expect(() =>
      browserWorkerHealthResponseSchema.parse({
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
        transport: {
          mode: 'vnc',
          provider: 'example',
        },
      }),
    ).toThrow();
  });

  it('normalizes and accepts profile input', () => {
    expect(
      createProfileRequestSchema.parse({
        avatarId: 'blue-fox',
        name: '  Living Room  ',
      }),
    ).toEqual({
      avatarId: 'blue-fox',
      name: 'Living Room',
    });

    expect(() => updateProfileRequestSchema.parse({})).toThrow();
  });

  it('accepts persistent profiles and nullable avatar data', () => {
    expect(
      profileSchema.parse({
        avatarId: null,
        createdAt: '2026-07-28T12:00:00.000Z',
        id: '51428272-68d9-4a9e-a242-c4f3ca1b0723',
        name: 'Family',
        updatedAt: '2026-07-28T12:00:00.000Z',
      }).name,
    ).toBe('Family');
  });

  it('distinguishes profile and Guest session requests', () => {
    expect(
      createBrowserSessionRequestSchema.parse({
        accessToken: 'a'.repeat(43),
        kind: 'guest',
      }),
    ).toEqual({
      accessToken: 'a'.repeat(43),
      applicationId: 'youtube',
      kind: 'guest',
    });

    expect(() =>
      createBrowserSessionRequestSchema.parse({
        kind: 'profile',
      }),
    ).toThrow();
  });

  it('accepts a stopped browser session', () => {
    expect(
      browserSessionSchema.parse({
        applicationId: 'youtube',
        createdAt: '2026-07-28T12:00:00.000Z',
        endedAt: '2026-07-28T13:00:00.000Z',
        failureReason: null,
        id: '2abfc294-b100-48e1-93ad-bd34718e9a97',
        kind: 'guest',
        lastSeenAt: '2026-07-28T12:30:00.000Z',
        profileId: null,
        status: 'stopped',
        streamUrl: '/stream/2abfc294-b100-48e1-93ad-bd34718e9a97/',
        updatedAt: '2026-07-28T13:00:00.000Z',
      }).status,
    ).toBe('stopped');
  });

  it('requires release images to be pinned by digest', () => {
    const valid = {
      image: `ghcr.io/example/mediadeck@sha256:${'a'.repeat(64)}`,
      publishedAt: '2026-07-28T12:00:00.000Z',
      schemaVersion: 1,
      version: '0.2.0',
    };

    expect(updateManifestSchema.parse(valid).version).toBe('0.2.0');
    expect(() =>
      updateManifestSchema.parse({
        ...valid,
        image: 'ghcr.io/example/mediadeck:latest',
      }),
    ).toThrow();
  });

  it('defaults older administrator settings to balanced stream quality', () => {
    expect(
      administratorSettingsSchema.parse({
        automaticUpdateChecks: true,
        backupRetentionCount: 5,
      }).streamQualityPreset,
    ).toBe('balanced');
    expect(() =>
      administratorSettingsSchema.parse({
        automaticUpdateChecks: true,
        backupRetentionCount: 5,
        streamQualityPreset: 'ultra',
      }),
    ).toThrow();
  });
});
