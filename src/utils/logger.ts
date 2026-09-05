import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Singleton structured Pino logger instance.
 * Automatically handles log level switching based on current NODE_ENV.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'development' ? 'debug' : 'info',
  base: {
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
