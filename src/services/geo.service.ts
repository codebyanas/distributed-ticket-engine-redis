import type { Event, Prisma } from '@prisma/client';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { BadRequestError } from '../utils/custom-errors.js';

export const VENUES_GEO_KEY = 'venues:geo';
const MAX_SEARCH_LIMIT = 100;
const MAX_RADIUS_KM = 500;

export interface NearbyEventSearchQuery {
	lat: number;
	lng: number;
	radiusKm: number;
	limit: number;
}

export interface NearbyEventResult {
	eventId: string;
	name: string;
	startsAt: Date;
	venue: {
		id: string;
		name: string;
		latitude: number;
		longitude: number;
	};
	distanceKm: number;
}

interface GeoVenueDistance {
	venueId: string;
	distanceKm: number;
}

type EventWithVenue = Prisma.EventGetPayload<{ include: { venue: true } }>;

/**
 * Rebuilds the Redis geospatial index from active PostgreSQL venues.
 *
 * @returns Promise resolving to the number of indexed venues.
 * @concurrency Impact: GEOADD is idempotent for each venue member; concurrent syncs converge on the same coordinates.
 * @complexity Time: O(N log N) for N venues | Space: O(N) Redis index storage.
 */
export const syncVenuesToGeoIndex = async (): Promise<number> => {
	const venues = await prisma.venue.findMany({
		select: { id: true, latitude: true, longitude: true },
	});
	if (venues.length === 0) {
		return 0;
	}

	const pipeline = redis.pipeline();
	for (const venue of venues) {
		pipeline.geoadd(VENUES_GEO_KEY, Number(venue.longitude), Number(venue.latitude), venue.id);
	}
	await pipeline.exec();
	return venues.length;
};

/**
 * Finds active future events near a coordinate using Redis GEOSEARCH and PostgreSQL hydration.
 *
 * @param query - Validated coordinate, radius, and result limit.
 * @returns Promise resolving to events ordered by ascending Redis-calculated distance.
 * @concurrency Impact: Performs read-only Redis and PostgreSQL operations; no shared mutable state is changed.
 * @complexity Time: O(log N + K log K + M) for N venues, K nearby venues, and M matching events.
 */
export const searchNearbyEvents = async (query: NearbyEventSearchQuery): Promise<NearbyEventResult[]> => {
	validateSearchQuery(query);
	const rawResults: unknown = await redis.geosearch(
		VENUES_GEO_KEY,
		'FROMLONLAT', query.lng, query.lat,
		'BYRADIUS', query.radiusKm, 'km', 'ASC', 'WITHDIST',
		'COUNT', Math.min(query.limit * 4, MAX_SEARCH_LIMIT),
	);
	const nearbyVenues = parseGeoResults(rawResults);
	if (nearbyVenues.length === 0) {
		return [];
	}

	const events = await prisma.event.findMany({
		where: {
			venueId: { in: nearbyVenues.map((venue) => venue.venueId) },
			isActive: true,
			startsAt: { gte: new Date() },
		},
		include: { venue: true },
	});
	const distanceByVenueId = new Map(nearbyVenues.map((venue) => [venue.venueId, venue.distanceKm]));
	return events
		.filter((event: EventWithVenue): event is Event & { venue: NonNullable<EventWithVenue['venue']> } => event.venue !== null)
		.sort((left, right) => (distanceByVenueId.get(left.venueId ?? '') ?? Infinity) - (distanceByVenueId.get(right.venueId ?? '') ?? Infinity))
		.slice(0, query.limit)
		.map((event) => ({
			eventId: event.id,
			name: event.name,
			startsAt: event.startsAt,
			venue: {
				id: event.venue.id,
				name: event.venue.name,
				latitude: Number(event.venue.latitude),
				longitude: Number(event.venue.longitude),
			},
			distanceKm: distanceByVenueId.get(event.venueId ?? '') ?? 0,
		}));
};

const validateSearchQuery = (query: NearbyEventSearchQuery): void => {
	if (!Number.isFinite(query.lat) || query.lat < -90 || query.lat > 90) {
		throw new BadRequestError('lat must be between -90 and 90');
	}
	if (!Number.isFinite(query.lng) || query.lng < -180 || query.lng > 180) {
		throw new BadRequestError('lng must be between -180 and 180');
	}
	if (!Number.isFinite(query.radiusKm) || query.radiusKm <= 0 || query.radiusKm > MAX_RADIUS_KM) {
		throw new BadRequestError(`radiusKm must be greater than 0 and no more than ${MAX_RADIUS_KM}`);
	}
	if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_SEARCH_LIMIT) {
		throw new BadRequestError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`);
	}
};

const parseGeoResults = (rawResults: unknown): GeoVenueDistance[] => {
	if (!Array.isArray(rawResults)) {
		return [];
	}
	const results: GeoVenueDistance[] = [];
	if (rawResults.every((result: unknown): boolean => Array.isArray(result))) {
		for (const result of rawResults) {
			if (!Array.isArray(result)) {
				continue;
			}
			const venueId = result[0];
			const distance = result[1];
			if (typeof venueId === 'string' && typeof distance === 'string' && Number.isFinite(Number(distance))) {
				results.push({ venueId, distanceKm: Number(distance) });
			}
		}
		return results;
	}
	for (let index = 0; index + 1 < rawResults.length; index += 2) {
		const venueId = rawResults[index];
		const distance = rawResults[index + 1];
		if (typeof venueId === 'string' && typeof distance === 'string' && Number.isFinite(Number(distance))) {
			results.push({ venueId, distanceKm: Number(distance) });
		}
	}
	return results;
};
