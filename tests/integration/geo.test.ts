import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { prisma } from '../../src/config/database.config.js';
import { connectRedis, disconnectRedis, redis } from '../../src/config/redis.config.js';
import { syncVenuesToGeoIndex, VENUES_GEO_KEY } from '../../src/services/geo.service.js';
import app from '../../src/app.js';

const fixtureVenues = [
    { id: 'phase-6-test-near', name: 'Phase 6 Near Venue', latitude: 24.8607, longitude: 67.0011 },
    { id: 'phase-6-test-edge', name: 'Phase 6 Edge Venue', latitude: 24.9507, longitude: 67.0011 },
    { id: 'phase-6-test-far', name: 'Phase 6 Far Venue', latitude: 25.2048, longitude: 55.2708 },
];
const fixtureEventIds = ['phase-6-test-event-near', 'phase-6-test-event-edge', 'phase-6-test-event-far'];

const clearRateLimitKeys = async (): Promise<void> => {
    let cursor = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'rate-limit:*', 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } while (cursor !== '0');
};

beforeAll(async (): Promise<void> => {
    if (redis.status === 'wait') {
        await connectRedis();
    }
    await prisma.event.deleteMany({ where: { id: { in: fixtureEventIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: fixtureVenues.map((venue) => venue.id) } } });
    await prisma.venue.createMany({ data: fixtureVenues });
    await prisma.event.createMany({
        data: [
            { id: fixtureEventIds[0], name: 'Near Event', startsAt: new Date('2026-12-20T18:00:00.000Z'), venueId: fixtureVenues[0]?.id, isActive: true },
            { id: fixtureEventIds[1], name: 'Edge Event', startsAt: new Date('2026-12-21T18:00:00.000Z'), venueId: fixtureVenues[1]?.id, isActive: true },
            { id: fixtureEventIds[2], name: 'Far Event', startsAt: new Date('2026-12-22T18:00:00.000Z'), venueId: fixtureVenues[2]?.id, isActive: true },
        ],
    });
    await syncVenuesToGeoIndex();
});

afterAll(async (): Promise<void> => {
    await prisma.event.deleteMany({ where: { id: { in: fixtureEventIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: fixtureVenues.map((venue) => venue.id) } } });
    await redis.zrem(VENUES_GEO_KEY, ...fixtureVenues.map((venue) => venue.id));
    await disconnectRedis();
    await prisma.$disconnect();
});

describe('geo event search integration', (): void => {
    beforeEach(async (): Promise<void> => {
        await clearRateLimitKeys();
    });

    it('includes nearby venues and excludes venues outside the radius', async (): Promise<void> => {
        const response = await request(app)
            .get('/api/v1/events/search/geo')
            .query({ lat: 24.8607, lng: 67.0011, radiusKm: 10, limit: 20 });

        expect(response.status).toBe(200);
        expect(response.body.data.map((event: { eventId: string }) => event.eventId)).toContain(fixtureEventIds[0]);
        expect(response.body.data.map((event: { eventId: string }) => event.eventId)).not.toContain(fixtureEventIds[2]);
        expect(response.body.data[0].distanceKm).toBeLessThanOrEqual(10);
    });

    it('returns an empty data array when no venue is in the radius', async (): Promise<void> => {
        const response = await request(app)
            .get('/api/v1/events/search/geo')
            .query({ lat: 0, lng: 0, radiusKm: 1, limit: 20 });

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual([]);
        expect(response.body.meta.count).toBe(0);
    });

    it('enforces the result limit and rejects invalid bounds', async (): Promise<void> => {
        const limitedResponse = await request(app)
            .get('/api/v1/events/search/geo')
            .query({ lat: 24.8607, lng: 67.0011, radiusKm: 500, limit: 1 });
        const invalidResponse = await request(app)
            .get('/api/v1/events/search/geo')
            .query({ lat: 24.8607, lng: 67.0011, radiusKm: 10, limit: 101 });

        expect(limitedResponse.status).toBe(200);
        expect(limitedResponse.body.data).toHaveLength(1);
        expect(invalidResponse.status).toBe(400);
    });
});
