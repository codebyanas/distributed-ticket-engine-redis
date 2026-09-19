export interface SeatingMapBenchmarkRequest {
	eventId: string;
	useRedis: boolean;
	concurrency: number;
	clearCacheBeforeRun: boolean;
}

export interface SeatingMapBenchmarkResponse {
	eventId: string;
	mode: 'direct' | 'redis-protected';
	concurrency: number;
	cacheWasCleared: boolean;
	result: {
		successfulRequests: number;
		failedRequests: number;
		databaseLoads: number;
		cacheHits: number;
		mutexAcquired: number;
		mutexWaiters: number;
		averageDurationMs: number;
		minDurationMs: number;
		maxDurationMs: number;
		totalDurationMs: number;
	};
	phase2Passed: boolean;
}

export interface SeatHoldBenchmarkRequest {
	eventId: string;
	seatId: string;
	concurrency: number;
}

export interface SeatHoldBenchmarkResponse {
	eventId: string;
	targetSeatId: string;
	concurrency: number;
	executionMode: 'redis-atomic-lua';
	result: {
		successfulHolds: number;
		conflicts: number;
		oversellingRate: '0%';
		totalExecutionTimeMs: number;
	};
}