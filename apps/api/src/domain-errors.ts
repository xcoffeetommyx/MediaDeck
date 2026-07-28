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
