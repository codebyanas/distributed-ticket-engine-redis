import http from 'http';
import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.config.js';
import { connectRedis, disconnectRedis } from './config/redis.config.js';
import { logger } from './utils/logger.js';
import { startOrderConsumer, stopOrderConsumer } from './workers/stream-consumer.worker.js';
import { startWebSocketServer } from './websocket/socket.server.js';

/**
 * Initializes and starts the HTTP listener on the configured port.
 * Tests PostgreSQL database connection and registers process signal handlers.
 * 
 * @returns Promise resolving to active HTTP Server instance.
 */
const startServer = async (): Promise<http.Server> => {
  // Verify PostgreSQL Database Connection
  await connectDatabase();
  await connectRedis();
  const server = http.createServer(app);
  const webSocketLifecycle = await startWebSocketServer(server);
  void startOrderConsumer().catch((error: unknown) => {
    logger.error({ err: error }, 'Order stream consumer stopped unexpectedly');
  });

  server.listen(env.PORT, () => {
    logger.info(`EventLock Engine running on http://localhost:${env.PORT} [Environment: ${env.NODE_ENV}]`);
  });

  /**
   * Performs graceful process shutdown by closing database connection pool and HTTP server listeners.
   * 
   * @param signal - Received OS signal identifier.
   */
  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}. Initiating graceful shutdown sequence...`);

    try {
      await stopOrderConsumer();
      await webSocketLifecycle.close();
      await disconnectRedis();
      await disconnectDatabase();
    } catch (err) {
      logger.error({ err }, 'Error disconnecting PostgreSQL during shutdown');
    }

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
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });

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

void startServer();
