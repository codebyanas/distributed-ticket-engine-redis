import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/custom-errors.js';
import { getSeatingMapForMode } from '../services/stampede.service.js';

/**
 * Returns an event seating map through the cache stampede shield.
 *
 * @param request - Express request containing the event ID route parameter.
 * @param response - Express response used to return the seating map.
 * @returns Promise resolving after the HTTP response is sent.
 * @concurrency Impact: Delegates cache misses to the distributed mutex service.
 * @complexity Time: O(1) on cache hit plus bounded cache/database work on miss.
 */
export const getEventSeatingMap = async (request: Request, response: Response): Promise<void> => {
	const rawUseRedis = request.query.useRedis;
	const useRedis = rawUseRedis === undefined || rawUseRedis === 'true';
	if (rawUseRedis !== undefined && rawUseRedis !== 'true' && rawUseRedis !== 'false') {
		throw new BadRequestError('useRedis must be true or false');
	}
	if (!useRedis && env.NODE_ENV === 'production') {
		throw new BadRequestError('Direct database mode is disabled in production');
	}
	const result = await getSeatingMapForMode(request.params.eventId as string, useRedis);
	response.status(200).json(result.map);
};