/**
 * Redis-based seat hold operations using a preloaded Lua script.
 *
 * The service keeps the atomic check-and-set logic in Redis and exposes a small,
 * typed contract to business services so application code never performs a race-prone
 * read-check-write sequence.
 */
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { redis } from '../config/redis.config.js';
import { getLuaScriptDigest, getLuaScriptSource } from '../scripts/lua-loader.js';

export type SeatLockResult = 1 | 0 | -1 | -2 | -3;

export interface SeatLockExecution {
	readonly result: SeatLockResult;
	readonly holdId: string;
	readonly ttlSeconds: number;
	readonly expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 600;

const isNoscriptError = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.message.toUpperCase().includes('NOSCRIPT');
};

const seatLockKey = (eventId: string, seatId: string): string => `seat:${eventId}:${seatId}`;

/**
 * Executes the atomic seat-hold Lua script for a single seat.
 *
 * @param eventId - Event identifier for the target seat.
 * @param seatId - Seat identifier within the event.
 * @param userId - User attempting to hold the seat.
 * @param ttlSeconds - Hold lifetime in seconds.
 * @param client - Redis client used for the atomic script execution.
 * @returns Promise resolving to the script result code and metadata.
 *
 * @concurrency Impact: Redis runs the validation and state mutation inside a single Lua execution.
 * This removes the race window between check and set.
 * @complexity Time: O(1) | Space: O(1)
 */
export const acquireSeatHold = async (
	eventId: string,
	seatId: string,
	userId: string,
	ttlSeconds: number = DEFAULT_TTL_SECONDS,
	client: Redis = redis,
): Promise<SeatLockExecution> => {
	const key = seatLockKey(eventId, seatId);
	const holdId = randomUUID();
	const effectiveTtl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;

	try {
		const result = await client.evalsha(
			getLuaScriptDigest('atomicSeatLock'),
			1,
			key,
			userId,
			holdId,
			effectiveTtl,
		) as number;

		return {
			result: result as SeatLockResult,
			holdId,
			ttlSeconds: effectiveTtl,
			expiresAt: Date.now() + effectiveTtl * 1000,
		};
	} catch (error: unknown) {
		if (!isNoscriptError(error)) {
			throw error;
		}

		const fallback = await client.eval(
			await getLuaScriptSource('atomicSeatLock'),
			1,
			key,
			userId,
			holdId,
			effectiveTtl,
		) as number;

		return {
			result: fallback as SeatLockResult,
			holdId,
			ttlSeconds: effectiveTtl,
			expiresAt: Date.now() + effectiveTtl * 1000,
		};
	}
};

/**
 * Releases a held seat only when the caller still owns the exact hold.
 *
 * @param eventId - Event identifier for the target seat.
 * @param seatId - Seat identifier scoped under the event.
 * @param userId - User that created the hold.
 * @param holdId - Exact hold identifier stored in the Redis value.
 * @param client - Redis client used to execute the atomic release script.
 * @returns Promise resolving to true when the Redis hold was deleted.
 * @concurrency Impact: Redis verifies ownership and deletes the key atomically, preventing stale releases from removing newer holds.
 * @complexity Time: O(1) | Space: O(1)
 */
export const releaseSeatHold = async (
	eventId: string,
	seatId: string,
	userId: string,
	holdId: string,
	client: Redis = redis,
): Promise<boolean> => {
	const key = seatLockKey(eventId, seatId);
	try {
		const result = await client.evalsha(
			getLuaScriptDigest('releaseSeat'),
			1,
			key,
			userId,
			holdId,
		) as number;
		return result === 1;
	} catch (error: unknown) {
		if (!isNoscriptError(error)) {
			throw error;
		}
		const result = await client.eval(
			await getLuaScriptSource('releaseSeat'),
			1,
			key,
			userId,
			holdId,
		) as number;
		return result === 1;
	}
};

/**
 * Exposes the seat key format so service code can coordinate lock state.
 *
 * @param eventId - Event identifier for the seat.
 * @param seatId - Seat identifier scoped under the event.
 * @returns Redis key used for the atomic seat state.
 */
export const getSeatLockKey = (eventId: string, seatId: string): string => seatLockKey(eventId, seatId);
