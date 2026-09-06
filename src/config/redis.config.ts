import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Shared Redis client for rate limiting, locking, caching, streams, and pub/sub.
 * The client connects lazily so startup can verify the connection explicitly.
 */
export const redis = new Redis(env.REDIS_URL, {
	lazyConnect: true,
	maxRetriesPerRequest: 3,
	enableReadyCheck: true,
});

redis.on('error', (error: Error): void => {
	logger.error({ err: error }, 'Redis client error');
});

/**
 * Connects to Redis and verifies command availability with PING.
 *
 * @returns Promise resolving when Redis is ready for application traffic.
 * @concurrency Impact: Initializes one shared client connection for all requests.
 * @complexity Time: O(1) | Space: O(1)
 */
export const connectRedis = async (): Promise<void> => {
	try {
		logger.info('Connecting to Redis...');
		await redis.connect();
		await redis.ping();
		logger.info('Redis connected successfully.');
	} catch (error: unknown) {
		const errorDetails = error instanceof Error
			? { name: error.name, message: error.message, stack: error.stack }
			: { message: typeof error === 'string' ? error : 'Unknown Redis error', value: error };

		logger.error({ err: errorDetails, redisUrl: env.REDIS_URL }, 'Redis connection failed');
		if (redis.status !== 'end') {
			redis.disconnect();
		}
		throw error;
	}
};

/**
 * Gracefully closes the shared Redis connection.
 *
 * @returns Promise resolving after Redis has acknowledged the disconnect.
 * @concurrency Impact: Stops new Redis commands before process shutdown.
 * @complexity Time: O(1) | Space: O(1)
 */
export const disconnectRedis = async (): Promise<void> => {
	try {
		if (redis.status === 'ready') {
			await redis.quit();
			logger.info('Redis connection closed.');
		} else if (redis.status !== 'end') {
			redis.disconnect();
			logger.info('Redis client disconnected before it became ready.');
		}
	} catch (error: unknown) {
		const errorDetails = error instanceof Error
			? { name: error.name, message: error.message, stack: error.stack }
			: { message: typeof error === 'string' ? error : 'Unknown Redis disconnect error', value: error };

		logger.error({ err: errorDetails }, 'Error during Redis disconnect');
	}
};
