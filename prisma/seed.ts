import 'dotenv/config';
import { prisma, disconnectDatabase } from '../src/config/database.config.js';
import { connectRedis, disconnectRedis } from '../src/config/redis.config.js';
import { syncVenuesToGeoIndex } from '../src/services/geo.service.js';

interface SeedVenue {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
}

const venueClusters: Array<{ latitude: number; longitude: number; name: string }> = [
    { latitude: 24.8607, longitude: 67.0011, name: 'Karachi' },
    { latitude: 31.5204, longitude: 74.3587, name: 'Lahore' },
    { latitude: 33.6844, longitude: 73.0479, name: 'Islamabad' },
    { latitude: 25.2048, longitude: 55.2708, name: 'Dubai' },
    { latitude: 40.7128, longitude: -74.006, name: 'New York' },
    { latitude: 51.5074, longitude: -0.1278, name: 'London' },
];

const buildVenues = (): SeedVenue[] => Array.from({ length: 1000 }, (_, index) => {
    const cluster = venueClusters[index % venueClusters.length];
    const ring = Math.floor(index / venueClusters.length) % 10;
    const offset = (ring - 4.5) * 0.012;
    return {
        id: `phase-6-venue-${String(index + 1).padStart(4, '0')}`,
        name: `${cluster.name} Concert Venue ${String(index + 1).padStart(4, '0')}`,
        latitude: Number((cluster.latitude + offset).toFixed(6)),
        longitude: Number((cluster.longitude + offset).toFixed(6)),
    };
});

const main = async (): Promise<void> => {
    const eventId = 'phase-2-demo-event';
    const venues = buildVenues();
    const primaryVenue = venues[0];
    if (primaryVenue === undefined) {
        throw new Error('Venue seed fixture is empty');
    }

    await prisma.event.deleteMany({ where: { id: { startsWith: 'phase-6-event-' } } });
    await prisma.venue.deleteMany({ where: { id: { startsWith: 'phase-6-venue-' } } });
    await prisma.venue.createMany({ data: venues });
    await prisma.event.createMany({
        data: venues.map((venue, index) => ({
            id: `phase-6-event-${String(index + 1).padStart(4, '0')}`,
            name: `${venue.name} Live Festival`,
            startsAt: new Date('2026-12-20T18:00:00.000Z'),
            venueId: venue.id,
            isActive: true,
        })),
    });

    await prisma.event.upsert({
        where: { id: eventId },
        update: {
            name: 'Phase 2 Demo Concert',
            startsAt: new Date('2026-12-20T18:00:00.000Z'),
            venueId: primaryVenue.id,
            isActive: true,
        },
        create: {
            id: eventId,
            name: 'Phase 2 Demo Concert',
            startsAt: new Date('2026-12-20T18:00:00.000Z'),
            venueId: primaryVenue.id,
            isActive: true,
        },
    });

    await prisma.seat.deleteMany({ where: { eventId } });
    const seats: Array<{
        id: string;
        eventId: string;
        section: string;
        row: string;
        number: string;
        status: 'AVAILABLE';
    }> = [];

    for (let sectionIndex = 1; sectionIndex <= 2; sectionIndex += 1) {
        for (let rowIndex = 1; rowIndex <= 5; rowIndex += 1) {
            for (let seatNumber = 1; seatNumber <= 10; seatNumber += 1) {
                seats.push({
                    id: `${eventId}-${sectionIndex}-${rowIndex}-${seatNumber}`,
                    eventId,
                    section: `SECTION-${sectionIndex}`,
                    row: `ROW-${rowIndex}`,
                    number: String(seatNumber),
                    status: 'AVAILABLE',
                });
            }
        }
    }

    await prisma.seat.createMany({ data: seats });
    await syncVenuesToGeoIndex();
    process.stdout.write(`Seed completed: venues=${venues.length}, event=${eventId}, seats=${seats.length}\n`);
};

try {
    await connectRedis();
    await main();
} finally {
    await disconnectRedis();
    await disconnectDatabase();
}
