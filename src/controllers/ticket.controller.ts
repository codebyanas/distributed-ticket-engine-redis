import type { Request, Response } from 'express';
import { z } from 'zod';
import { createOrder, holdSeat, releaseSeat } from '../services/ticket.service.js';
import type { CreateOrderRequest, HoldSeatRequest, ReleaseSeatRequest } from '../types/ticket.types.js';
import { BadRequestError } from '../utils/custom-errors.js';

const holdSeatRequestSchema = z.object({
	eventId: z.string().min(1, 'eventId is required'),
	seatId: z.string().min(1, 'seatId is required'),
	userId: z.string().min(1, 'userId is required'),
});

const createOrderRequestSchema = holdSeatRequestSchema;
const releaseSeatRequestSchema = holdSeatRequestSchema.extend({ holdId: z.string().min(1, 'holdId is required') });

/**
 * Handles seat-hold requests from the HTTP API layer.
 *
 * @param request - Express request containing the ticket hold payload.
 * @param response - Express response used to return the hold outcome.
 * @returns Promise resolving after the HTTP response is sent.
 *
 * @concurrency Impact: Delegates the race-prone state mutation to the service and Redis Lua script.
 * @complexity Time: O(1) validation plus O(log N) seat lookup and O(1) Redis lock execution.
 */
export const holdSeatHandler = async (request: Request, response: Response): Promise<void> => {
	const parsed = holdSeatRequestSchema.safeParse(request.body);
	if (!parsed.success) {
		throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Request validation failed');
	}

	const result = await holdSeat(parsed.data as HoldSeatRequest);
	response.status(result.statusCode).json(result);
};

/**
 * Accepts a seat order for asynchronous stream settlement.
 *
 * @param request - Express request containing event, seat, and user identifiers.
 * @param response - Express response returning the durable processing order ID.
 * @returns Promise resolving after the HTTP 202 response is sent.
 * @concurrency Impact: The request performs only Redis hold and stream publication; settlement runs in a worker.
 * @complexity Time: O(log N) for the seat lookup plus O(1) Redis stream publication.
 */
export const createOrderHandler = async (request: Request, response: Response): Promise<void> => {
	const parsed = createOrderRequestSchema.safeParse(request.body);
	if (!parsed.success) {
		throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Request validation failed');
	}

	const result = await createOrder(parsed.data as CreateOrderRequest);
	response.status(202).json(result);
};

/**
 * Releases a caller-owned seat hold through the explicit release path.
 *
 * @param request - Express request containing hold ownership data.
 * @param response - Express response returning the release result.
 * @returns Promise resolving after the HTTP response is sent.
 * @concurrency Impact: The service performs ownership validation inside an atomic Redis Lua operation.
 * @complexity Time: O(1) validation and Redis release plus indexed persistence update.
 */
export const releaseSeatHandler = async (request: Request, response: Response): Promise<void> => {
	const parsed = releaseSeatRequestSchema.safeParse(request.body);
	if (!parsed.success) {
		throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Request validation failed');
	}
	const result = await releaseSeat(parsed.data as ReleaseSeatRequest);
	response.status(200).json(result);
};
