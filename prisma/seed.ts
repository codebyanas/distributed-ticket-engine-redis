import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required');
}

const pool = new pg.Pool({
    connectionString: databaseUrl,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const main = async (): Promise<void> => {
    const eventId = 'phase-2-demo-event';

    await prisma.event.upsert({
        where: { id: eventId },
        update: {
            name: 'Phase 2 Demo Concert',
            startsAt: new Date('2026-12-20T18:00:00.000Z'),
        },
        create: {
            id: eventId,
            name: 'Phase 2 Demo Concert',
            startsAt: new Date('2026-12-20T18:00:00.000Z'),
        },
    });

    await prisma.seat.deleteMany({
        where: { eventId },
    });

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
                const section = `SECTION-${sectionIndex}`;
                const row = `ROW-${rowIndex}`;
                const number = String(seatNumber);

                seats.push({
                    id: `${eventId}-${sectionIndex}-${rowIndex}-${seatNumber}`,
                    eventId,
                    section,
                    row,
                    number,
                    status: 'AVAILABLE',
                });
            }
        }
    }

    await prisma.seat.createMany({
        data: seats,
    });

    process.stdout.write(
        `Seed completed: event=${eventId}, seats=${seats.length}\n`,
    );
};

try {
    await main();
} finally {
    await prisma.$disconnect();
    await pool.end();
}