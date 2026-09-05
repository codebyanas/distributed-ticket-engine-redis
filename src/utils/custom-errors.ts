/**
 * Base application domain error class.
 * All operational domain errors extend from this class.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error raised when a requested resource is not found (HTTP 404).
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * Error raised when client request payload validation fails (HTTP 400).
 */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

/**
 * Error raised when state conflict occurs, e.g., seat already reserved (HTTP 409).
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource state conflict') {
    super(message, 409);
  }
}

/**
 * Error raised when rate limit threshold is exceeded (HTTP 429).
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429);
  }
}
