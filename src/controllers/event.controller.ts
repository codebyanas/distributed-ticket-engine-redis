import type { Request, Response } from 'express';
import { getSeatingMap } from '../services/stampede.service.js';

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
	const seatingMap = await getSeatingMap(request.params.eventId as string);
	response.status(200).json(seatingMap);
};