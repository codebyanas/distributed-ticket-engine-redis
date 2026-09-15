import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { getLuaScriptDigest } from '../scripts/lua-loader.js';
import type {
	SeatingMap,
	SeatingMapExecutionMeta,
	SeatingMapResult,
	SeatingMapSeat,
	SeatState,
} from '../types/ticket.types.js';

const CACHE_TTL_SECONDS = 60;
const LOCK_TTL_MS = 5_000;
const WAIT_ATTEMPTS = 8;
const WAIT_DELAY_MS = 25;

export const seatingMapCacheKey = (eventId: string): string => `event:seating-map:${eventId}`;
const lockKey = (eventId: string): string => `lock:event:seating-map:${eventId}`;

const sleep = async (milliseconds: number): Promise<void> => {
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

/**
 * Acquires a short-lived per-event mutex for cache rehydration.
 *
 * @param client - Redis client used for the atomic SET NX PX operation.
 * @param key - Mutex key scoped to one event seating map.
 * @returns A unique token when acquired, otherwise null.
 * @concurrency Impact: SET NX PX permits one rehydrator and guarantees automatic recovery after owner failure.
 * @complexity Time: O(1) | Space: O(1)
 */
export const acquireMutex = async (client: Redis, key: string): Promise<string | null> => {
	const token = randomUUID();
	const result = await client.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
	return result === 'OK' ? token : null;
};

/**
 * Releases a mutex only when its value belongs to the current owner.
 *
 * @param client - Redis client executing the registered atomic release script.
 * @param key - Mutex key to release.
 * @param token - Owner token returned by acquireMutex.
 * @returns Promise resolving after the atomic compare-and-delete operation.
 * @concurrency Impact: Prevents an expired owner's late DEL from deleting a newer owner's lock.
 * @complexity Time: O(1) | Space: O(1)
 */
export const releaseMutex = async (client: Redis, key: string, token: string): Promise<void> => {
	await client.evalsha(getLuaScriptDigest('releaseMutex'), 1, key, token);
};

const readCachedMap = async (client: Redis, key: string): Promise<SeatingMap | null> => {
	const value = await client.get(key);
	if (value === null) {
		return null;
	}
	return JSON.parse(value) as SeatingMap;
};

const loadFromDatabase = async (eventId: string): Promise<SeatingMap> => {
	const event = await prisma.event.findUnique({
		where: { id: eventId },
		include: { seats: { orderBy: [{ section: 'asc' }, { row: 'asc' }, { number: 'asc' }] } },
	});
	if (event === null) {
		throw new Error(`Event not found: ${eventId}`);
	}
	const seats: SeatingMapSeat[] = event.seats.map((seat) => ({
		id: seat.id,
		section: seat.section,
		row: seat.row,
		number: seat.number,
		status: seat.status as SeatState,
	}));
	return {
		eventId: event.id,
		eventName: event.name,
		startsAt: event.startsAt.toISOString(),
		seats,
	};
};

/**
 * Loads a seating map directly from PostgreSQL without using Redis.
 *
 * @param eventId - Event whose seating map is requested.
 * @returns Promise resolving to the database seating map.
 * @concurrency Impact: Intentionally bypasses the stampede shield for controlled before/after diagnostics only.
 * @complexity Time: O(log N) for indexed event lookup plus O(S) for S seats returned.
 */
export const getSeatingMapDirect = async (eventId: string): Promise<SeatingMap> =>
	loadFromDatabase(eventId);

/**
 * Deletes the cached seating map for a diagnostic cold-cache run.
 *
 * @param eventId - Event whose cached map should be removed.
 * @param client - Redis client used for deletion.
 * @returns Promise resolving after the cache key is deleted.
 * @concurrency Impact: Only diagnostic callers should clear a key; active production requests may repopulate it.
 * @complexity Time: O(1) | Space: O(1)
 */
export const clearSeatingMapCache = async (eventId: string, client: Redis = redis): Promise<void> => {
	await client.del(seatingMapCacheKey(eventId));
};

/**
 * Reads an event seating map through a cache-aside flow protected by a distributed mutex.
 *
 * @param eventId - Event whose seating map is requested.
 * @param client - Redis client used for cache and mutex operations.
 * @returns Promise resolving to the current seating map.
 * @concurrency Impact: Cache misses elect one PostgreSQL loader; competing requests retry Redis instead of querying PostgreSQL.
 * @complexity Time: Cache hit O(1); miss O(log N) for the indexed database query plus bounded retry work.
 */
export const getSeatingMapWithMetrics = async (
	eventId: string,
	client: Redis = redis,
): Promise<SeatingMapResult> => {
	const startedAt = Date.now();
	const key = seatingMapCacheKey(eventId);
	const mutex = lockKey(eventId);
	const cached = await readCachedMap(client, key);
	if (cached !== null) {
		return {
			map: cached,
			meta: {
				mode: 'redis-protected',
				cacheHit: true,
				lockAcquired: false,
				waitedForLock: false,
				databaseLoaded: false,
				durationMs: Date.now() - startedAt,
			},
		};
	}

	const token = await acquireMutex(client, mutex);
	if (token !== null) {
		try {
			const refreshed = await readCachedMap(client, key);
			if (refreshed !== null) {
				return {
					map: refreshed,
					meta: {
						mode: 'redis-protected',
						cacheHit: true,
						lockAcquired: true,
						waitedForLock: false,
						databaseLoaded: false,
						durationMs: Date.now() - startedAt,
					},
				};
			}
			const map = await loadFromDatabase(eventId);
			await client.set(key, JSON.stringify(map), 'EX', CACHE_TTL_SECONDS);
			return {
				map,
				meta: {
					mode: 'redis-protected',
					cacheHit: false,
					lockAcquired: true,
					waitedForLock: false,
					databaseLoaded: true,
					durationMs: Date.now() - startedAt,
				},
			};
		} finally {
			await releaseMutex(client, mutex, token);
		}
	}

	for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
		await sleep(WAIT_DELAY_MS);
		const hydrated = await readCachedMap(client, key);
		if (hydrated !== null) {
			return {
				map: hydrated,
				meta: {
					mode: 'redis-protected',
					cacheHit: true,
					lockAcquired: false,
					waitedForLock: true,
					databaseLoaded: false,
					durationMs: Date.now() - startedAt,
				},
			};
		}
	}
	throw new Error(`Seating map hydration timed out for event: ${eventId}`);
};

/**
 * Reads a seating map using either direct PostgreSQL or the Redis stampede shield.
 *
 * @param eventId - Event whose seating map is requested.
 * @param useRedis - Selects the protected cache-aside path when true.
 * @param client - Redis client used by the protected path.
 * @returns Promise resolving to the map and diagnostic execution metadata.
 * @concurrency Impact: Direct mode bypasses Redis; protected mode permits one database hydrator per event.
 * @complexity Time: Direct O(log N + S); protected O(1) on hit or bounded retry plus database load on miss.
 */
export const getSeatingMapForMode = async (
	eventId: string,
	useRedis: boolean,
	client: Redis = redis,
): Promise<SeatingMapResult> => {
	if (!useRedis) {
		const startedAt = Date.now();
		const map = await getSeatingMapDirect(eventId);
		return {
			map,
			meta: {
				mode: 'direct',
				cacheHit: false,
				lockAcquired: false,
				waitedForLock: false,
				databaseLoaded: true,
				durationMs: Date.now() - startedAt,
			},
		};
	}
	return getSeatingMapWithMetrics(eventId, client);
};

/**
 * Reads a seating map through the normal production cache-protected path.
 *
 * @param eventId - Event whose seating map is requested.
 * @param client - Redis client used for cache and mutex operations.
 * @returns Promise resolving to the seating map.
 * @concurrency Impact: Uses the distributed mutex on cache misses.
 * @complexity Time: O(1) on cache hit plus bounded cache/database work on miss.
 */
export const getSeatingMap = async (eventId: string, client: Redis = redis): Promise<SeatingMap> => {
	const result = await getSeatingMapWithMetrics(eventId, client);
	return result.map;
};
