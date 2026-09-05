import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "http";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./utils/logger.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { NotFoundError } from "./utils/custom-errors.js";

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
