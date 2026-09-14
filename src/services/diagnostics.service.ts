import { clearSeatingMapCache, getSeatingMapForMode } from './stampede.service.js';
import type { SeatingMapBenchmarkRequest, SeatingMapBenchmarkResponse } from '../types/diagnostics.types.js';

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