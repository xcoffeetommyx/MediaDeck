import Database from 'better-sqlite3';

import type {
  BrowserSession,
  BrowserSessionKind,
  BrowserSessionStatus,
  MediaApplicationId,
  OperationEvent,
  Profile,
  ProfileAddon,
} from '@mediadeck/contracts';

import { CapacityError, ConflictError, NotFoundError } from './domain-errors.js';

const activeSessionStatuses = ['starting', 'running', 'stopping'] as const;

type ProfileRow = {
  avatar_id: string | null;
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
};

type SessionRow = {
  access_token_hash: string | null;
  application_id: MediaApplicationId;
  created_at: string;
  ended_at: string | null;
  failure_reason: string | null;
  id: string;
  kind: BrowserSessionKind;
  last_seen_at: string;
  profile_id: string | null;
  status: BrowserSessionStatus;
  storage_path: string;
  updated_at: string;
  worker_id: string | null;
};

type OperationEventRow = {
  category: OperationEvent['category'];
  created_at: string;
  id: number;
  level: OperationEvent['level'];
  message: string;
};

type AddonRow = {
  addon_id: string;
  enabled: number;
  installed_at: string;
  max_firefox_version: string | null;
  min_firefox_version: string | null;
  name: string;
  package_filename: string;
  permissions_json: string;
  profile_id: string;
  sha256: string;
  source: ProfileAddon['source'];
  updated_at: string;
  version: string;
};

export type StoredAdministratorSecurity = {
  pinHash: string;
  pinSalt: string;
  updatedAt: string;
};

export type StoredBrowserSession = BrowserSession & {
  accessTokenHash: string | null;
  storagePath: string;
  workerId: string | null;
};

export type NewStoredBrowserSession = {
  accessTokenHash: string;
  applicationId: MediaApplicationId;
  createdAt: string;
  id: string;
  kind: BrowserSessionKind;
  lastSeenAt: string;
  profileId: string | null;
  storagePath: string;
  updatedAt: string;
};

export type StoredProfileAddon = ProfileAddon & {
  packageFilename: string;
};

function mapProfile(row: ProfileRow): Profile {
  return {
    avatarId: row.avatar_id,
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: SessionRow): StoredBrowserSession {
  return {
    accessTokenHash: row.access_token_hash,
    applicationId: row.application_id,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    failureReason: row.failure_reason,
    id: row.id,
    kind: row.kind,
    lastSeenAt: row.last_seen_at,
    profileId: row.profile_id,
    status: row.status,
    storagePath: row.storage_path,
    streamUrl: `/stream/${row.id}/`,
    updatedAt: row.updated_at,
    workerId: row.worker_id,
  };
}

function mapOperationEvent(row: OperationEventRow): OperationEvent {
  return {
    category: row.category,
    createdAt: row.created_at,
    id: row.id,
    level: row.level,
    message: row.message,
  };
}

function mapAddon(row: AddonRow): StoredProfileAddon {
  const permissions: unknown = JSON.parse(row.permissions_json);
  return {
    enabled: row.enabled === 1,
    id: row.addon_id,
    installedAt: row.installed_at,
    maxFirefoxVersion: row.max_firefox_version,
    minFirefoxVersion: row.min_firefox_version,
    name: row.name,
    packageFilename: row.package_filename,
    permissions: Array.isArray(permissions)
      ? permissions.filter((value): value is string => typeof value === 'string')
      : [],
    profileId: row.profile_id,
    sha256: row.sha256,
    source: row.source,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class MediaDeckStore {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    this.#database = new Database(databasePath, {
      timeout: 5_000,
    });
    this.#database.pragma('foreign_keys = ON');
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('synchronous = NORMAL');
    this.#migrate();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 48),
        avatar_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY,
        access_token_hash TEXT,
        application_id TEXT NOT NULL DEFAULT 'youtube',
        kind TEXT NOT NULL CHECK(kind IN ('profile', 'guest')),
        profile_id TEXT REFERENCES profiles(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK(
          status IN ('starting', 'running', 'stopping', 'stopped', 'failed')
        ),
        storage_path TEXT NOT NULL,
        worker_id TEXT,
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT,
        CHECK(
          (kind = 'profile' AND profile_id IS NOT NULL) OR
          (kind = 'guest' AND profile_id IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_profile
      ON browser_sessions(profile_id)
      WHERE profile_id IS NOT NULL
        AND status IN ('starting', 'running', 'stopping');

      CREATE INDEX IF NOT EXISTS browser_sessions_status
      ON browser_sessions(status);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS administrator_security (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('info', 'warning', 'error')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS operation_events_created_at
      ON operation_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS profile_addons (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
        addon_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        package_filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('upload', 'watched')),
        permissions_json TEXT NOT NULL,
        min_firefox_version TEXT,
        max_firefox_version TEXT,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, addon_id)
      );

      CREATE INDEX IF NOT EXISTS profile_addons_profile
      ON profile_addons(profile_id);

    `);

    const profileColumns = this.#database.pragma('table_info(profiles)') as {
      name: string;
    }[];
    if (!profileColumns.some((column) => column.name === 'deleted_at')) {
      this.#database.exec('ALTER TABLE profiles ADD COLUMN deleted_at TEXT');
    }

    const sessionColumns = this.#database.pragma('table_info(browser_sessions)') as {
      name: string;
    }[];
    if (!sessionColumns.some((column) => column.name === 'application_id')) {
      this.#database.exec(
        "ALTER TABLE browser_sessions ADD COLUMN application_id TEXT NOT NULL DEFAULT 'youtube'",
      );
    }
    if (!sessionColumns.some((column) => column.name === 'access_token_hash')) {
      this.#database.exec(
        'ALTER TABLE browser_sessions ADD COLUMN access_token_hash TEXT',
      );
    }

    this.#database.pragma('user_version = 6');
  }

  async backupDatabase(destination: string): Promise<void> {
    await this.#database.backup(destination);
  }

  close(): void {
    this.#database.close();
  }

  getSchemaVersion(): number {
    return this.#database.pragma('user_version', { simple: true }) as number;
  }

  isHealthy(): boolean {
    return (this.#database.pragma('quick_check', { simple: true }) as string) === 'ok';
  }

  getSetting(key: string): string | undefined {
    const row = this.#database
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string, updatedAt: string): void {
    this.#database
      .prepare(
        `
          INSERT INTO app_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `,
      )
      .run(key, value, updatedAt);
  }

  getAdministratorSecurity(): StoredAdministratorSecurity | undefined {
    const row = this.#database
      .prepare(
        `
          SELECT pin_hash, pin_salt, updated_at
          FROM administrator_security
          WHERE id = 1
        `,
      )
      .get() as { pin_hash: string; pin_salt: string; updated_at: string } | undefined;

    return row
      ? {
          pinHash: row.pin_hash,
          pinSalt: row.pin_salt,
          updatedAt: row.updated_at,
        }
      : undefined;
  }

  setAdministratorSecurity(security: StoredAdministratorSecurity | null): void {
    if (!security) {
      this.#database.prepare('DELETE FROM administrator_security WHERE id = 1').run();
      return;
    }

    this.#database
      .prepare(
        `
          INSERT INTO administrator_security (
            id, pin_hash, pin_salt, updated_at
          ) VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            pin_hash = excluded.pin_hash,
            pin_salt = excluded.pin_salt,
            updated_at = excluded.updated_at
        `,
      )
      .run(security.pinHash, security.pinSalt, security.updatedAt);
  }

  recordEvent(
    category: OperationEvent['category'],
    level: OperationEvent['level'],
    message: string,
    createdAt = new Date().toISOString(),
  ): OperationEvent {
    const result = this.#database
      .prepare(
        `
          INSERT INTO operation_events (category, level, message, created_at)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(category, level, message, createdAt);

    this.#database
      .prepare(
        `
          DELETE FROM operation_events
          WHERE id NOT IN (
            SELECT id FROM operation_events ORDER BY id DESC LIMIT 500
          )
        `,
      )
      .run();

    return {
      category,
      createdAt,
      id: Number(result.lastInsertRowid),
      level,
      message,
    };
  }

  listEvents(limit = 100): OperationEvent[] {
    const rows = this.#database
      .prepare(
        `
          SELECT id, category, level, message, created_at
          FROM operation_events
          ORDER BY id DESC
          LIMIT ?
        `,
      )
      .all(Math.min(Math.max(limit, 1), 200)) as OperationEventRow[];
    return rows.map(mapOperationEvent);
  }

  getProfileCount(): number {
    const row = this.#database
      .prepare('SELECT count(*) AS count FROM profiles WHERE deleted_at IS NULL')
      .get() as { count: number };
    return row.count;
  }

  getFailedSessionCount(): number {
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM browser_sessions WHERE status = 'failed'")
      .get() as { count: number };
    return row.count;
  }

  createProfile(profile: Profile): Profile {
    this.#database
      .prepare(
        `
          INSERT INTO profiles (
            id, name, avatar_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        profile.id,
        profile.name,
        profile.avatarId,
        profile.createdAt,
        profile.updatedAt,
      );

    return profile;
  }

  listProfiles(): Profile[] {
    const rows = this.#database
      .prepare(
        `
          SELECT id, name, avatar_id, created_at, updated_at
          FROM profiles
          WHERE deleted_at IS NULL
          ORDER BY lower(name), created_at
        `,
      )
      .all() as ProfileRow[];

    return rows.map(mapProfile);
  }

  getProfile(id: string): Profile | undefined {
    const row = this.#database
      .prepare(
        `
          SELECT id, name, avatar_id, created_at, updated_at
          FROM profiles
          WHERE id = ? AND deleted_at IS NULL
        `,
      )
      .get(id) as ProfileRow | undefined;

    return row ? mapProfile(row) : undefined;
  }

  requireProfile(id: string): Profile {
    const profile = this.getProfile(id);
    if (!profile) {
      throw new NotFoundError(`Profile ${id} was not found`);
    }

    return profile;
  }

  updateProfile(
    id: string,
    updates: {
      avatarId?: string | null;
      name?: string;
    },
    updatedAt: string,
  ): Profile {
    const current = this.requireProfile(id);
    const next: Profile = {
      ...current,
      avatarId: updates.avatarId === undefined ? current.avatarId : updates.avatarId,
      name: updates.name ?? current.name,
      updatedAt,
    };

    this.#database
      .prepare(
        `
          UPDATE profiles
          SET name = ?, avatar_id = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(next.name, next.avatarId, next.updatedAt, id);

    return next;
  }

  deleteProfile(id: string, deletedAt: string): void {
    this.requireProfile(id);

    if (this.findActiveSessionByProfile(id)) {
      throw new ConflictError('Stop the active profile session before deleting it');
    }

    this.#database.transaction(() => {
      this.#database.prepare('DELETE FROM profile_addons WHERE profile_id = ?').run(id);
      this.#database
        .prepare(
          `
            UPDATE profiles
            SET deleted_at = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(deletedAt, deletedAt, id);
    })();
  }

  listProfileAddons(profileId: string): StoredProfileAddon[] {
    this.requireProfile(profileId);
    const rows = this.#database
      .prepare(
        `
          SELECT *
          FROM profile_addons
          WHERE profile_id = ?
          ORDER BY lower(name), addon_id
        `,
      )
      .all(profileId) as AddonRow[];
    return rows.map(mapAddon);
  }

  getProfileAddon(profileId: string, addonId: string): StoredProfileAddon | undefined {
    const row = this.#database
      .prepare(
        `
          SELECT *
          FROM profile_addons
          WHERE profile_id = ? AND addon_id = ?
        `,
      )
      .get(profileId, addonId) as AddonRow | undefined;
    return row ? mapAddon(row) : undefined;
  }

  upsertProfileAddon(addon: StoredProfileAddon): StoredProfileAddon {
    this.requireProfile(addon.profileId);
    this.#database
      .prepare(
        `
          INSERT INTO profile_addons (
            profile_id, addon_id, name, version, enabled, package_filename,
            sha256, source, permissions_json, min_firefox_version,
            max_firefox_version, installed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(profile_id, addon_id) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            enabled = excluded.enabled,
            package_filename = excluded.package_filename,
            sha256 = excluded.sha256,
            source = excluded.source,
            permissions_json = excluded.permissions_json,
            min_firefox_version = excluded.min_firefox_version,
            max_firefox_version = excluded.max_firefox_version,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        addon.profileId,
        addon.id,
        addon.name,
        addon.version,
        addon.enabled ? 1 : 0,
        addon.packageFilename,
        addon.sha256,
        addon.source,
        JSON.stringify(addon.permissions),
        addon.minFirefoxVersion,
        addon.maxFirefoxVersion,
        addon.installedAt,
        addon.updatedAt,
      );
    return this.getProfileAddon(addon.profileId, addon.id)!;
  }

  setProfileAddonEnabled(
    profileId: string,
    addonId: string,
    enabled: boolean,
    updatedAt: string,
  ): StoredProfileAddon {
    const current = this.getProfileAddon(profileId, addonId);
    if (!current) {
      throw new NotFoundError(`Add-on ${addonId} was not found for this profile`);
    }
    this.#database
      .prepare(
        `
          UPDATE profile_addons
          SET enabled = ?, updated_at = ?
          WHERE profile_id = ? AND addon_id = ?
        `,
      )
      .run(enabled ? 1 : 0, updatedAt, profileId, addonId);
    return this.getProfileAddon(profileId, addonId)!;
  }

  deleteProfileAddon(profileId: string, addonId: string): StoredProfileAddon {
    const current = this.getProfileAddon(profileId, addonId);
    if (!current) {
      throw new NotFoundError(`Add-on ${addonId} was not found for this profile`);
    }
    this.#database
      .prepare('DELETE FROM profile_addons WHERE profile_id = ? AND addon_id = ?')
      .run(profileId, addonId);
    return current;
  }

  createSession(
    session: NewStoredBrowserSession,
    maxActiveSessions: number,
  ): StoredBrowserSession {
    const create = this.#database.transaction(() => {
      const activeCount = this.#database
        .prepare(
          `
            SELECT count(*) AS count
            FROM browser_sessions
            WHERE status IN ('starting', 'running', 'stopping')
          `,
        )
        .get() as { count: number };

      if (activeCount.count >= maxActiveSessions) {
        throw new CapacityError(
          `Browser session capacity of ${maxActiveSessions} has been reached`,
        );
      }

      if (session.profileId) {
        this.requireProfile(session.profileId);
        if (this.findActiveSessionByProfile(session.profileId)) {
          throw new ConflictError('This profile already has an active session');
        }
      }

      this.#database
        .prepare(
          `
            INSERT INTO browser_sessions (
              id, access_token_hash, application_id, kind, profile_id, status,
              storage_path, worker_id,
              failure_reason, created_at, updated_at, last_seen_at, ended_at
            ) VALUES (?, ?, ?, ?, ?, 'starting', ?, NULL, NULL, ?, ?, ?, NULL)
          `,
        )
        .run(
          session.id,
          session.accessTokenHash,
          session.applicationId,
          session.kind,
          session.profileId,
          session.storagePath,
          session.createdAt,
          session.updatedAt,
          session.lastSeenAt,
        );
    });

    create();
    return this.requireSession(session.id);
  }

  listSessions(): StoredBrowserSession[] {
    const rows = this.#database
      .prepare(
        `
          SELECT *
          FROM browser_sessions
          ORDER BY created_at DESC
        `,
      )
      .all() as SessionRow[];

    return rows.map(mapSession);
  }

  listActiveSessions(): StoredBrowserSession[] {
    const placeholders = activeSessionStatuses.map(() => '?').join(', ');
    const rows = this.#database
      .prepare(
        `
          SELECT *
          FROM browser_sessions
          WHERE status IN (${placeholders})
          ORDER BY created_at
        `,
      )
      .all(...activeSessionStatuses) as SessionRow[];

    return rows.map(mapSession);
  }

  getSession(id: string): StoredBrowserSession | undefined {
    const row = this.#database
      .prepare('SELECT * FROM browser_sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;

    return row ? mapSession(row) : undefined;
  }

  requireSession(id: string): StoredBrowserSession {
    const session = this.getSession(id);
    if (!session) {
      throw new NotFoundError(`Browser session ${id} was not found`);
    }

    return session;
  }

  findActiveSessionByProfile(profileId: string): StoredBrowserSession | undefined {
    const row = this.#database
      .prepare(
        `
          SELECT *
          FROM browser_sessions
          WHERE profile_id = ?
            AND status IN ('starting', 'running', 'stopping')
          LIMIT 1
        `,
      )
      .get(profileId) as SessionRow | undefined;

    return row ? mapSession(row) : undefined;
  }

  updateSession(
    id: string,
    update: {
      endedAt?: string | null;
      failureReason?: string | null;
      lastSeenAt?: string;
      status?: BrowserSessionStatus;
      updatedAt: string;
      workerId?: string | null;
    },
  ): StoredBrowserSession {
    const current = this.requireSession(id);
    const next = {
      endedAt: update.endedAt === undefined ? current.endedAt : update.endedAt,
      failureReason:
        update.failureReason === undefined
          ? current.failureReason
          : update.failureReason,
      lastSeenAt: update.lastSeenAt ?? current.lastSeenAt,
      status: update.status ?? current.status,
      updatedAt: update.updatedAt,
      workerId: update.workerId === undefined ? current.workerId : update.workerId,
    };

    this.#database
      .prepare(
        `
          UPDATE browser_sessions
          SET status = ?, worker_id = ?, failure_reason = ?, updated_at = ?,
              last_seen_at = ?, ended_at = ?
          WHERE id = ?
        `,
      )
      .run(
        next.status,
        next.workerId,
        next.failureReason,
        next.updatedAt,
        next.lastSeenAt,
        next.endedAt,
        id,
      );

    return this.requireSession(id);
  }

  reactivateSession(
    id: string,
    maxActiveSessions: number,
    updatedAt: string,
  ): StoredBrowserSession {
    const reactivate = this.#database.transaction(() => {
      const session = this.requireSession(id);
      const otherActiveCount = this.#database
        .prepare(
          `
            SELECT count(*) AS count
            FROM browser_sessions
            WHERE id != ?
              AND status IN ('starting', 'running', 'stopping')
          `,
        )
        .get(id) as { count: number };

      if (otherActiveCount.count >= maxActiveSessions) {
        throw new CapacityError(
          `Browser session capacity of ${maxActiveSessions} has been reached`,
        );
      }

      if (
        session.profileId &&
        this.#database
          .prepare(
            `
              SELECT 1
              FROM browser_sessions
              WHERE id != ?
                AND profile_id = ?
                AND status IN ('starting', 'running', 'stopping')
              LIMIT 1
            `,
          )
          .get(id, session.profileId)
      ) {
        throw new ConflictError('This profile already has an active session');
      }

      this.#database
        .prepare(
          `
            UPDATE browser_sessions
            SET status = 'starting', worker_id = NULL, failure_reason = NULL,
                updated_at = ?, ended_at = NULL
            WHERE id = ?
          `,
        )
        .run(updatedAt, id);
    });

    reactivate();
    return this.requireSession(id);
  }
}
