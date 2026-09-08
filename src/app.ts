import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "http";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./utils/logger.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { NotFoundError } from "./utils/custom-errors.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import { env } from "./config/env.js";

/**
 * Factory function that initializes and configures the Express application.
 * Configures security headers, body parsing, request logging, and core routes.
 *
 * @returns Fully configured Express Application instance.
 */
export const createApp = (): Express => {
  const app: Express = express();

  // Security and parsing middlewares
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // HTTP request logging
  app.use(
    pinoHttp({
      logger,
      customSuccessMessage: (req, res) =>
        `${req.method} ${req.url} ${res.statusCode}`,
      customErrorMessage: (req, res, err) =>
        `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
    }),
  );

  app.use(rateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    skip: (request: Request): boolean => request.path === "/" || request.path === "/health",
  }));

  // Root & Health check routes
  app.get("/", (_req: Request, res: Response): void => {
    res.status(200).json({
      name: "EventLock Engine API",
      status: "online",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health", (_req: Request, res: Response): void => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/v1/rate-limit-test", (_req: Request, res: Response): void => {
    res.status(200).json({
      status: "ok",
      message: "Request passed the Redis rate limiter",
    });
  });

  // Catch-all 404 handler for unknown routes
  app.use((_req: Request, _res: Response, next: NextFunction): void => {
    next(new NotFoundError("Requested endpoint does not exist"));
  });

  // Centralized error handling middleware
  app.use(errorHandler);

  return app;
};

const app = createApp();
export default app;
