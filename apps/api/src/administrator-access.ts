import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type {
  AdministratorStatus,
  UnlockAdministratorResponse,
} from '@mediadeck/contracts';

import { RateLimitError, UnauthorizedError } from './domain-errors.js';
import type { MediaDeckStore } from './store.js';

const tokenLifetimeMilliseconds = 15 * 60 * 1000;
const attemptWindowMilliseconds = 15 * 60 * 1000;
const maximumFailedAttempts = 5;

type TokenRecord = {
  expiresAt: number;
};

type AttemptRecord = {
  count: number;
  windowStartedAt: number;
};

function hashPin(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 64, {
    maxmem: 32 * 1024 * 1024,
    N: 16_384,
    p: 1,
    r: 8,
  });
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

export class AdministratorAccess {
  readonly #attempts = new Map<string, AttemptRecord>();
  readonly #now: () => Date;
  readonly #store: MediaDeckStore;
  readonly #tokens = new Map<string, TokenRecord>();

  constructor(store: MediaDeckStore, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#now = now;
  }

  getStatus(authorization?: string): AdministratorStatus {
    const security = this.#store.getAdministratorSecurity();
    if (!security) {
      return {
        authenticated: true,
        expiresAt: null,
        pinEnabled: false,
      };
    }

    const record = this.getTokenRecord(authorization);
    return {
      authenticated: Boolean(record),
      expiresAt: record ? new Date(record.expiresAt).toISOString() : null,
      pinEnabled: true,
    };
  }

  require(authorization?: string): void {
    if (!this.#store.getAdministratorSecurity()) return;
    if (!this.getTokenRecord(authorization)) {
      throw new UnauthorizedError();
    }
  }

  unlock(pin: string, clientKey: string): UnlockAdministratorResponse {
    const security = this.#store.getAdministratorSecurity();
    if (!security) {
      const token = this.issueToken();
      return {
        status: this.getStatus(`Bearer ${token}`),
        token,
      };
    }

    this.assertAttemptAllowed(clientKey);
    const actual = hashPin(pin, Buffer.from(security.pinSalt, 'base64url'));
    const expected = Buffer.from(security.pinHash, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      this.recordFailedAttempt(clientKey);
      throw new UnauthorizedError('The administrator PIN was incorrect');
    }

    this.#attempts.delete(clientKey);
    const token = this.issueToken();
    this.#store.recordEvent(
      'administration',
      'info',
      'Administrator controls were unlocked',
      this.#now().toISOString(),
    );
    return {
      status: this.getStatus(`Bearer ${token}`),
      token,
    };
  }

  setPin(pin: string | null, authorization?: string): AdministratorStatus {
    this.require(authorization);
    const timestamp = this.#now().toISOString();

    if (pin === null) {
      this.#store.setAdministratorSecurity(null);
      this.#tokens.clear();
      this.#store.recordEvent(
        'administration',
        'warning',
        'Administrator PIN protection was disabled',
        timestamp,
      );
      return this.getStatus();
    }

    const salt = randomBytes(16);
    this.#store.setAdministratorSecurity({
      pinHash: hashPin(pin, salt).toString('base64url'),
      pinSalt: salt.toString('base64url'),
      updatedAt: timestamp,
    });
    this.#tokens.clear();
    this.#store.recordEvent(
      'administration',
      'info',
      'Administrator PIN protection was enabled or changed',
      timestamp,
    );
    return this.getStatus();
  }

  lock(authorization?: string): AdministratorStatus {
    const token = bearerToken(authorization);
    if (token) this.#tokens.delete(token);
    return this.getStatus();
  }

  private assertAttemptAllowed(clientKey: string): void {
    const attempt = this.#attempts.get(clientKey);
    const now = this.#now().getTime();
    if (!attempt || now - attempt.windowStartedAt >= attemptWindowMilliseconds) {
      this.#attempts.delete(clientKey);
      return;
    }
    if (attempt.count >= maximumFailedAttempts) {
      throw new RateLimitError(
        'Too many incorrect PIN attempts. Try again in 15 minutes.',
      );
    }
  }

  private getTokenRecord(authorization?: string): TokenRecord | undefined {
    const token = bearerToken(authorization);
    if (!token) return undefined;
    const record = this.#tokens.get(token);
    if (!record) return undefined;
    if (record.expiresAt <= this.#now().getTime()) {
      this.#tokens.delete(token);
      return undefined;
    }
    return record;
  }

  private issueToken(): string {
    const token = randomBytes(32).toString('base64url');
    this.#tokens.set(token, {
      expiresAt: this.#now().getTime() + tokenLifetimeMilliseconds,
    });
    return token;
  }

  private recordFailedAttempt(clientKey: string): void {
    const now = this.#now().getTime();
    const current = this.#attempts.get(clientKey);
    if (!current || now - current.windowStartedAt >= attemptWindowMilliseconds) {
      this.#attempts.set(clientKey, {
        count: 1,
        windowStartedAt: now,
      });
      return;
    }
    current.count += 1;
  }
}
