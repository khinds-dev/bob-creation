/**
 * Base application error hierarchy.
 * All domain and infrastructure errors derive from AppError to enable
 * uniform error handling in the presentation layer.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Errors arising from domain rule violations */
export class DomainError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

/** Request payload or parameter validation failures */
export class ValidationError extends AppError {
  public readonly fields?: Record<string, string[]>;

  constructor(message: string, fields?: Record<string, string[]>) {
    super(message, 400);
    this.fields = fields;
  }
}

/** Resource does not exist */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} '${id}' not found` : `${resource} not found`, 404);
  }
}

/** Duplicate or conflicting resource */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

/** Caller is not authenticated */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/** Caller lacks permission */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/** Too many requests — rate limit exceeded */
export class RateLimitError extends AppError {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Rate limit exceeded', 429);
    this.retryAfterMs = retryAfterMs;
  }
}
