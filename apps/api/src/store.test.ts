import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MediaDeckStore } from './store.js';

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'mediadeck-store-'));
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe('MediaDeck database migrations', () => {
  it('upgrades an early profile table without losing metadata', () => {
    const databasePath = join(dataDirectory, 'legacy.sqlite');
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO profiles (id, name, avatar_id, created_at, updated_at)
      VALUES (
        '51428272-68d9-4a9e-a242-c4f3ca1b0723',
        'Legacy',
        NULL,
        '2026-07-28T12:00:00.000Z',
        '2026-07-28T12:00:00.000Z'
      );
    `);
    legacy.close();

    const store = new MediaDeckStore(databasePath);

    expect(store.listProfiles()).toHaveLength(1);
    expect(store.listProfiles()[0]?.name).toBe('Legacy');
    expect(store.getSchemaVersion()).toBe(6);
    store.close();
  });
});
