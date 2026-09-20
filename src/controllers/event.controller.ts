import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/custom-errors.js';
import { getSeatingMapForMode } from '../services/stampede.service.js';
import { searchNearbyEvents } from '../services/geo.service.js';
import type { NearbyEventSearchQuery } from '../services/geo.service.js';
import { z } from 'zod';

export const geoSearchQuerySchema = z.object({
	lat: z.coerce.number().finite().min(-90).max(90),
	lng: z.coerce.number().finite().min(-180).max(180),
	radiusKm: z.coerce.number().finite().gt(0).max(500).default(10),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

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

/**
 * Returns active future events near the requested geographic coordinate.
 *
 * @param request - Express request containing geo-search query parameters.
 * @param response - Express response used to return nearby events.
 * @returns Promise resolving after the HTTP response is sent.
 * @concurrency Impact: Delegates to read-only Redis and PostgreSQL queries.
 * @complexity Time: O(log N + K log K + M) for nearby venue and event counts.
 */
export const searchEventsByGeo = async (request: Request, response: Response): Promise<void> => {
	const parsedQuery = geoSearchQuerySchema.safeParse(request.query);
	if (!parsedQuery.success) {
		throw new BadRequestError(parsedQuery.error.issues.map((issue) => issue.message).join('; '));
	}
	const query: NearbyEventSearchQuery = parsedQuery.data;
	const data = await searchNearbyEvents(query);
	response.status(200).json({ data, meta: { ...query, count: data.length } });
};