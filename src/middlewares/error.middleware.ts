import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../utils/custom-errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Centralized global Express error interceptor middleware.
 * Formats standardized JSON response for domain operational errors and suppresses internal stack traces in production.
 * 
 * @param err - Intercepted Error instance.
 * @param _req - Express Request object.
 * @param res - Express Response object.
 * @param _next - Express NextFunction (retained for Express 4-parameter error handler signature).
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    logger.warn({ statusCode: err.statusCode, message: err.message }, 'Operational error intercepted');
    res.status(err.statusCode).json({
      status: 'fail',
      statusCode: err.statusCode,
      message: err.message,
    });
    return;
  }

  logger.error({ err }, 'Unhandled server exception');

  res.status(500).json({
    status: 'error',
    statusCode: 500,
    message: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
};
