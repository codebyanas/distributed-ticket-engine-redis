import { connectDatabase, disconnectDatabase } from '../config/database.config.js';
import { connectRedis, disconnectRedis } from '../config/redis.config.js';
import { logger } from '../utils/logger.js';
import { startOrderConsumer, stopOrderConsumer } from './stream-consumer.worker.js';

let shuttingDown = false;

const gracefulShutdown = async (signal: string): Promise<void> => {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	logger.info({ signal }, 'Worker shutdown started');
	await stopOrderConsumer();
	await disconnectRedis();
	await disconnectDatabase();
	process.exit(0);
};

const startWorker = async (): Promise<void> => {
	await connectDatabase();
	await connectRedis();
	process.on('SIGTERM', () => {
		void gracefulShutdown('SIGTERM');
	});
	process.on('SIGINT', () => {
		void gracefulShutdown('SIGINT');
	});
	await startOrderConsumer();
};

void startWorker().catch(async (error: unknown): Promise<void> => {
	logger.fatal({ err: error }, 'Order worker failed to start');
	await disconnectRedis();
	await disconnectDatabase();
	process.exit(1);
});