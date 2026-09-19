import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/custom-errors.js';
import { acquireSeatHold } from './redis-lock.service.js';
import {
	ORDER_EVENT_SCHEMA_VERSION,
	ORDER_EVENT_TYPE,
	ORDER_STREAM_KEY,
} from '../types/events.types.js';
import type {
	CreateOrderRequest,
	CreateOrderResponse,
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

	const execution = await acquireSeatHold(
		request.eventId,
		request.seatId,
		request.userId,
		DEFAULT_HOLD_TTL_SECONDS,
		client,
	);

	if (execution.result === 1) {
		const record: SeatHoldRecord = {
			holdId: execution.holdId,
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

/**
 * Creates a durable processing order and publishes its settlement event.
 *
 * @param payload - Event, seat, and user details for the order.
 * @param client - Redis client used to acquire the hold and append the stream event.
 * @returns Promise resolving to the asynchronous order identifier.
 * @concurrency Impact: Redis serializes the seat hold; the unique holdId makes worker retries idempotent.
 * @complexity Time: O(log N) for the indexed seat lookup plus O(1) Redis stream operations.
 */
export const createOrder = async (
	payload: CreateOrderRequest,
	client: Redis = redis,
): Promise<CreateOrderResponse> => {
	const request = normalizeHoldRequest(payload);
	const event = await prisma.event.findUnique({
		where: { id: request.eventId },
		include: { seats: { where: { id: request.seatId }, take: 1 } },
	});

	if (event === null) {
		throw new NotFoundError('Event not found');
	}
	const seat = event.seats[0];
	if (seat === undefined) {
		throw new NotFoundError('Seat not found for the event');
	}
	if (seat.status === 'SOLD') {
		throw new ConflictError('Seat already sold');
	}

	const execution = await acquireSeatHold(request.eventId, request.seatId, request.userId, DEFAULT_HOLD_TTL_SECONDS, client);
	if (execution.result !== 1) {
		throw new ConflictError('Seat is currently unavailable or already held');
	}

	const order = await prisma.$transaction(async (transaction) => {
		const heldSeat = await transaction.seat.updateMany({
			where: { id: request.seatId, eventId: request.eventId, status: 'AVAILABLE' },
			data: { status: 'HELD' },
		});
		if (heldSeat.count !== 1) {
			throw new ConflictError('Seat state changed before order creation');
		}
		return transaction.order.create({
			data: {
				holdId: execution.holdId,
				eventId: request.eventId,
				seatId: request.seatId,
				userId: request.userId,
				expiresAt: new Date(execution.expiresAt),
				status: 'PROCESSING',
			},
		});
	});

	const eventId = randomUUID();
	const eventPayload = {
		eventId,
		eventType: ORDER_EVENT_TYPE,
		schemaVersion: ORDER_EVENT_SCHEMA_VERSION,
		occurredAt: new Date().toISOString(),
		payload: {
			holdId: execution.holdId,
			orderId: order.id,
			eventId: request.eventId,
			seatId: request.seatId,
			userId: request.userId,
			expiresAt: new Date(execution.expiresAt).toISOString(),
		},
	};

	await client.xadd(
		ORDER_STREAM_KEY,
		'*',
		'eventId',
		eventPayload.eventId,
		'eventType',
		eventPayload.eventType,
		'schemaVersion',
		String(eventPayload.schemaVersion),
		'occurredAt',
		eventPayload.occurredAt,
		'payload',
		JSON.stringify(eventPayload.payload),
	);

	return { orderId: order.id, status: 'PROCESSING' };
};
