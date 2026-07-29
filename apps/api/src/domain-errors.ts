export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 'not_found', 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'conflict', 409);
  }
}

export class CapacityError extends DomainError {
  constructor(message: string) {
    super(message, 'capacity_reached', 429);
  }
}

export class WorkerUnavailableError extends DomainError {
  constructor(message: string) {
    super(message, 'browser_worker_unavailable', 503);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Administrator authorization is required') {
    super(message, 'administrator_authorization_required', 401);
  }
}

export class SessionUnauthorizedError extends DomainError {
  constructor() {
    super(
      'Valid authorization for this browser session is required',
      'session_authorization_required',
      401,
    );
  }
}

export class RateLimitError extends DomainError {
  constructor(message: string) {
    super(message, 'rate_limit_exceeded', 429);
  }
}
