import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { getLuaScriptDigest } from '../scripts/lua-loader.js';
import type { SeatingMap, SeatingMapSeat, SeatState } from '../types/ticket.types.js';

const CACHE_TTL_SECONDS = 60;
const LOCK_TTL_MS = 5_000;
const WAIT_ATTEMPTS = 8;
const WAIT_DELAY_MS = 25;

const cacheKey = (eventId: string): string => `event:seating-map:${eventId}`;
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
 * Reads an event seating map through a cache-aside flow protected by a distributed mutex.
 *
 * @param eventId - Event whose seating map is requested.
 * @param client - Redis client used for cache and mutex operations.
 * @returns Promise resolving to the current seating map.
 * @concurrency Impact: Cache misses elect one PostgreSQL loader; competing requests retry Redis instead of querying PostgreSQL.
 * @complexity Time: Cache hit O(1); miss O(log N) for the indexed database query plus bounded retry work.
 */
export const getSeatingMap = async (eventId: string, client: Redis = redis): Promise<SeatingMap> => {
	const key = cacheKey(eventId);
	const mutex = lockKey(eventId);
	const cached = await readCachedMap(client, key);
	if (cached !== null) {
		return cached;
	}

	const token = await acquireMutex(client, mutex);
	if (token !== null) {
		try {
			const refreshed = await readCachedMap(client, key);
			if (refreshed !== null) {
				return refreshed;
			}
			const map = await loadFromDatabase(eventId);
			await client.set(key, JSON.stringify(map), 'EX', CACHE_TTL_SECONDS);
			return map;
		} finally {
			await releaseMutex(client, mutex, token);
		}
	}

	for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
		await sleep(WAIT_DELAY_MS);
		const hydrated = await readCachedMap(client, key);
		if (hydrated !== null) {
			return hydrated;
		}
	}
	throw new Error(`Seating map hydration timed out for event: ${eventId}`);
};
