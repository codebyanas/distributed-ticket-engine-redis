import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/custom-errors.js';
import { acquireSeatHold } from './redis-lock.service.js';
import type {
	HoldSeatRequest,
	HoldSeatResponse,
	SeatHoldRecord,
} from '../types/ticket.types.js';

const DEFAULT_HOLD_TTL_SECONDS = 600;

/**
 * Validates the seat-hold request payload.
 *
 * @param payload - Client payload for the seat-hold request.
 * @returns Normalized request object with required string fields.
 * @concurrency Impact: Performs no Redis mutation, only validation for the business layer.
 * @complexity Time: O(1) | Space: O(1)
 */
const normalizeHoldRequest = (payload: Partial<HoldSeatRequest>): HoldSeatRequest => {
	const eventId = typeof payload.eventId === 'string' ? payload.eventId.trim() : '';
	const seatId = typeof payload.seatId === 'string' ? payload.seatId.trim() : '';
	const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';

	if (eventId.length === 0 || seatId.length === 0 || userId.length === 0) {
		throw new BadRequestError('eventId, seatId, and userId are required');
	}

	return {
		eventId,
		seatId,
		userId,
	};
};

/**
 * Acquires a temporary hold for a specific event seat.
 *
 * @param payload - HTTP payload for the seat-hold request.
 * @param client - Redis client used to execute the atomic Lua lock.
 * @returns Promise resolving to an HTTP-safe response object.
 *
 * @concurrency Impact: Delegates check-and-set to the Redis Lua script to prevent overselling under concurrency.
 * @complexity Time: O(log N) for the seat lookup plus O(1) Redis lock mutation.
 */
export const holdSeat = async (
	payload: Partial<HoldSeatRequest>,
	client: Redis = redis,
): Promise<HoldSeatResponse> => {
	const request = normalizeHoldRequest(payload);
	const event = await prisma.event.findUnique({
		where: { id: request.eventId },
		include: { seats: { where: { id: request.seatId }, take: 1 } },
	});

	if (event === null) {
		throw new NotFoundError('Event not found');
	}

	if (event.seats.length === 0) {
		throw new NotFoundError('Seat not found for the event');
	}

	const seat = event.seats[0];
	if (seat === undefined) {
		throw new NotFoundError('Seat not found for the event');
	}

	if (seat.status === 'SOLD') {
		throw new ConflictError('Seat already sold');
	}

	const holdId = randomUUID();
	const execution = await acquireSeatHold(
		request.eventId,
		request.seatId,
		request.userId,
		DEFAULT_HOLD_TTL_SECONDS,
		client,
	);

	if (execution.result === 1) {
		const record: SeatHoldRecord = {
			holdId,
			eventId: request.eventId,
			seatId: request.seatId,
			userId: request.userId,
			status: 'HELD',
			expiresAt: new Date(execution.expiresAt).toISOString(),
		};

		return {
			status: 'success',
			statusCode: 200,
			data: record,
		};
	}

	return {
		status: 'fail',
		statusCode: 409,
		message: 'Seat is currently unavailable or already held',
	};
};
