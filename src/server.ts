import http from 'http';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

/**
 * Initializes and starts the HTTP listener on the configured port.
 * Registers process signal handlers (SIGTERM, SIGINT) and exception guards.
 * 
 * @returns Active HTTP Server instance.
 */
const startServer = (): http.Server => {
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(`EventLock Engine running on http://localhost:${env.PORT} [Environment: ${env.NODE_ENV}]`);
  });

  /**
   * Performs graceful process shutdown by closing HTTP server listeners.
   * 
   * @param signal - Received OS signal identifier.
   */
  const gracefulShutdown = (signal: string): void => {
    logger.info(`Received ${signal}. Initiating graceful shutdown sequence...`);

    server.close((err?: Error) => {
      if (err) {
        logger.error({ err }, 'Error encountered while stopping HTTP server');
        process.exit(1);
      }
      logger.info('HTTP server stopped. Exiting process clean.');
      process.exit(0);
    });

    // Timeout fallback for un-drained active connections
    setTimeout(() => {
      logger.error('Forced shutdown invoked due to timeout draining connections.');
      process.exit(1);
    }, 10000).unref();
  };

  // OS Signal Listeners
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Unhandled exception and rejection process guards
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error }, 'Uncaught Exception thrown');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, 'Unhandled Promise Rejection detected');
    process.exit(1);
  });

  return server;
};

startServer();
