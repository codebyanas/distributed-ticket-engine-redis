import type { Request, Response } from 'express';
import { z } from 'zod';
import { holdSeat } from '../services/ticket.service.js';
import type { HoldSeatRequest } from '../types/ticket.types.js';
import { BadRequestError } from '../utils/custom-errors.js';

const holdSeatRequestSchema = z.object({
	eventId: z.string().min(1, 'eventId is required'),
	seatId: z.string().min(1, 'seatId is required'),
	userId: z.string().min(1, 'userId is required'),
});

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
