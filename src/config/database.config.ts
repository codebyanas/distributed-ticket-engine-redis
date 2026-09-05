import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Connection pool for PostgreSQL using pg driver
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);

/**
 * Singleton PrismaClient instance configured with PostgreSQL driver adapter.
 */
export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Tests and verifies connection to PostgreSQL database.
 * Catches connection, authentication, or network errors with structured logging.
 * 
 * @returns Promise resolving to true if connection succeeds, false otherwise.
 */
export const connectDatabase = async (): Promise<boolean> => {
  try {
    logger.info('Connecting to PostgreSQL database...');
    await prisma.$queryRaw`SELECT 1;`;
    logger.info('✅ PostgreSQL Database connected successfully.');
    return true;
  } catch (error: unknown) {
    const maskedUrl = env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');
    if (error instanceof Error) {
      logger.error(
        {
          name: error.name,
          message: error.message,
          databaseUrl: maskedUrl,
        },
        '❌ PostgreSQL Database connection failed'
      );
    } else {
      logger.error({ error, databaseUrl: maskedUrl }, '❌ Unknown database error occurred');
    }
    return false;
  }
};

/**
 * Gracefully disconnects Prisma and PG connection pool.
 */
export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    await pool.end();
    logger.info('PostgreSQL Database pool disconnected.');
  } catch (error: unknown) {
    logger.error({ error }, 'Error during PostgreSQL disconnect');
  }
};
