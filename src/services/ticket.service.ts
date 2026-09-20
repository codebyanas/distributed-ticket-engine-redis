import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/custom-errors.js';
import { logger } from '../utils/logger.js';
import { pubSubAdapter } from '../websocket/pubsub.adapter.js';
import { acquireSeatHold, releaseSeatHold } from './redis-lock.service.js';
import {
	ORDER_EVENT_SCHEMA_VERSION,
	ORDER_EVENT_TYPE,
	ORDER_STREAM_KEY,
	WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION,
} from '../types/events.types.js';
import type {
	CreateOrderRequest,
	CreateOrderResponse,
	HoldSeatRequest,
	HoldSeatResponse,
	SeatHoldRecord,
	ReleaseSeatRequest,
	ReleaseSeatResponse,
} from '../types/ticket.types.js';

const DEFAULT_HOLD_TTL_SECONDS = 600;

const publishSeatEvent = async (
	event: Parameters<typeof pubSubAdapter.publishSeatEvent>[0],
): Promise<void> => {
	try {
		await pubSubAdapter.publishSeatEvent(event);
	} catch (error: unknown) {
		logger.error({ err: error, eventId: event.eventId, eventType: event.eventType }, 'Failed to publish seat event');
	}
};

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
		await publishSeatEvent({
			eventId: randomUUID(),
			eventType: 'seat.held',
			schemaVersion: WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION,
			occurredAt: new Date().toISOString(),
			correlationId: record.holdId,
			payload: record,
		});

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

	await publishSeatEvent({
		eventId: randomUUID(),
		eventType: 'seat.held',
		schemaVersion: WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION,
		occurredAt: new Date().toISOString(),
		correlationId: execution.holdId,
		payload: {
			eventId: request.eventId,
			seatId: request.seatId,
			holdId: execution.holdId,
			status: 'HELD',
			expiresAt: new Date(execution.expiresAt).toISOString(),
		},
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

/**
 * Releases a caller-owned temporary hold and broadcasts the available state.
 *
 * @param payload - Event, seat, user, and ownership identifiers.
 * @param client - Redis client used for the atomic release.
 * @returns Promise resolving to the release response.
 * @concurrency Impact: Redis validates ownership and deletes the hold atomically before the database seat is made available.
 * @complexity Time: O(1) Redis release plus O(1) indexed database mutation.
 */
export const releaseSeat = async (
	payload: ReleaseSeatRequest,
	client: Redis = redis,
): Promise<ReleaseSeatResponse> => {
	const request = normalizeHoldRequest(payload);
	if (payload.holdId.trim().length === 0) {
		throw new BadRequestError('holdId is required');
	}
	const existingOrder = await prisma.order.findUnique({ where: { holdId: payload.holdId } });
	if (existingOrder !== null) {
		throw new ConflictError('Seat hold is already associated with an order');
	}
	const released = await releaseSeatHold(request.eventId, request.seatId, request.userId, payload.holdId, client);
	if (!released) {
		throw new ConflictError('Seat hold is unavailable or owned by another user');
	}
	await prisma.seat.updateMany({
		where: { id: request.seatId, eventId: request.eventId, status: 'HELD' },
		data: { status: 'AVAILABLE' },
	});
	await publishSeatEvent({
		eventId: randomUUID(),
		eventType: 'seat.released',
		schemaVersion: WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION,
		occurredAt: new Date().toISOString(),
		correlationId: payload.holdId,
		payload: {
			eventId: request.eventId,
			seatId: request.seatId,
			holdId: payload.holdId,
			status: 'AVAILABLE',
			reason: 'released',
		},
	});
	return { status: 'released', eventId: request.eventId, seatId: request.seatId, holdId: payload.holdId };
};
