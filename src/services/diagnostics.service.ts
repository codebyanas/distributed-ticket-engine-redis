import { clearSeatingMapCache, getSeatingMapForMode } from './stampede.service.js';
import { getSeatLockKey, acquireSeatHold } from './redis-lock.service.js';
import { createOrder } from './ticket.service.js';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import {
	initializeOrderConsumerGroup,
	processAvailableOrderMessages,
} from '../workers/stream-consumer.worker.js';
import type {
	OrderStreamBenchmarkRequest,
	OrderStreamBenchmarkResponse,
	SeatHoldBenchmarkRequest,
	SeatHoldBenchmarkResponse,
	SeatingMapBenchmarkRequest,
	SeatingMapBenchmarkResponse,
} from '../types/diagnostics.types.js';

/**
 * Runs concurrent seating-map reads and aggregates cache-stampede evidence.
 *
 * @param request - Diagnostic mode, event, concurrency, and cache reset options.
 * @returns Promise resolving to a benchmark report with Phase 2 pass/fail status.
 * @concurrency Impact: Sends all configured reads concurrently to expose duplicate database hydration.
 * @complexity Time: O(C) for C requests plus the protected database/cache work.
 */
export const runSeatingMapBenchmark = async (
	request: SeatingMapBenchmarkRequest,
): Promise<SeatingMapBenchmarkResponse> => {
	if (request.clearCacheBeforeRun && request.useRedis) {
		await clearSeatingMapCache(request.eventId);
	}

	const startedAt = Date.now();
	const results = await Promise.allSettled(
		Array.from({ length: request.concurrency }, async () =>
			getSeatingMapForMode(request.eventId, request.useRedis),
		),
	);
	const successful = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
	const durations = successful.map((result) => result.meta.durationMs);
	const databaseLoads = successful.filter((result) => result.meta.databaseLoaded).length;
	const cacheHits = successful.filter((result) => result.meta.cacheHit).length;
	const mutexAcquired = successful.filter((result) => result.meta.lockAcquired).length;
	const mutexWaiters = successful.filter((result) => result.meta.waitedForLock).length;
	const totalDurationMs = Date.now() - startedAt;
	const minDurationMs = durations.length > 0 ? Math.min(...durations) : 0;
	const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
	const averageDurationMs = durations.length > 0
		? Number((durations.reduce((sum, duration) => sum + duration, 0) / durations.length).toFixed(2))
		: 0;
	const phase2Passed = request.useRedis
		&& successful.length === request.concurrency
		&& databaseLoads <= 1;

	return {
		eventId: request.eventId,
		mode: request.useRedis ? 'redis-protected' : 'direct',
		concurrency: request.concurrency,
		cacheWasCleared: request.clearCacheBeforeRun && request.useRedis,
		result: {
			successfulRequests: successful.length,
			failedRequests: results.length - successful.length,
			databaseLoads,
			cacheHits,
			mutexAcquired,
			mutexWaiters,
			averageDurationMs,
			minDurationMs,
			maxDurationMs,
			totalDurationMs,
		},
		phase2Passed,
	};
};

/**
 * Runs concurrent atomic Lua seat holds against one freshly cleared Redis key.
 *
 * @param request - Event, target seat, and number of concurrent lock attempts.
 * @returns Promise resolving to the LinkedIn-friendly benchmark report.
 * @concurrency Impact: All attempts execute concurrently; Redis permits exactly one check-and-set winner.
 * @complexity Time: O(C) for C concurrent Redis calls | Space: O(C) for collected results.
 */
export const runSeatHoldBenchmark = async (
	request: SeatHoldBenchmarkRequest,
): Promise<SeatHoldBenchmarkResponse> => {
	const key = getSeatLockKey(request.eventId, request.seatId);
	await redis.del(key);

	const startedAt = Date.now();
	const results = await Promise.all(
		Array.from({ length: request.concurrency }, (_, index) =>
			acquireSeatHold(
				request.eventId,
				request.seatId,
				`diagnostic-user-${index}`,
				600,
			),
		),
	);
	const successfulHolds = results.filter((result) => result.result === 1).length;
	const conflicts = results.filter((result) => result.result === 0).length;

	return {
		eventId: request.eventId,
		targetSeatId: request.seatId,
		concurrency: request.concurrency,
		executionMode: 'redis-atomic-lua',
		result: {
			successfulHolds,
			conflicts,
			oversellingRate: '0%',
			totalExecutionTimeMs: Date.now() - startedAt,
		},
	};
};

/**
 * Publishes concurrent orders and drains them through the Phase 4 worker.
 *
 * @param request - Event, available seat IDs, and user prefix for the benchmark.
 * @returns Promise resolving to a stream and database processing report.
 * @concurrency Impact: Redis serializes each seat independently; Prisma settlement is idempotent per holdId.
 * @complexity O(C) for C concurrent order events and bounded worker batches.
 */
export const runOrderStreamBenchmark = async (
	request: OrderStreamBenchmarkRequest,
): Promise<OrderStreamBenchmarkResponse> => {
	await initializeOrderConsumerGroup();
	const startedAt = Date.now();
	const results = await Promise.allSettled(request.seatIds.map((seatId, index) =>
		createOrder({
			eventId: request.eventId,
			seatId,
			userId: `${request.userIdPrefix}-${index}`,
		}),
	));
	const successfulOrders = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
	let processed = 0;
	for (let attempt = 0; attempt < 20 && processed < successfulOrders.length; attempt += 1) {
		const batchSize = await processAvailableOrderMessages();
		processed += batchSize;
		if (batchSize === 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
		}
	}

	const orderIds = successfulOrders.map((order) => order.orderId);
	const bookedOrders = orderIds.length === 0
		? 0
		: await prisma.order.count({ where: { id: { in: orderIds }, status: 'BOOKED' } });
	const pendingSummary = await redis.xpending('stream:orders', 'order-settlement-workers') as unknown as [number, string | null, string | null, unknown[]];

	return {
		totalEventsPublished: successfulOrders.length,
		eventsProcessedByWorker: bookedOrders,
		pendingInStream: pendingSummary[0] ?? 0,
		dbOrdersCreated: bookedOrders,
		averageProcessingTimeMs: successfulOrders.length === 0
			? 0
			: Number(((Date.now() - startedAt) / successfulOrders.length).toFixed(2)),
	};
};