import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { prisma } from '../../src/config/database.config.js';
import { connectRedis, disconnectRedis, redis } from '../../src/config/redis.config.js';
import { createOrder } from '../../src/services/ticket.service.js';
import { getSeatLockKey } from '../../src/services/redis-lock.service.js';
import {
	ORDER_CONSUMER_GROUP,
	ORDER_STREAM_KEY,
} from '../../src/types/events.types.js';
import {
	initializeOrderConsumerGroup,
	processAvailableOrderMessages,
} from '../../src/workers/stream-consumer.worker.js';

describe('order stream integration', (): void => {
	const eventId = 'phase-4-integration-event';
	const seatId = 'phase-4-integration-seat';

	beforeAll(async (): Promise<void> => {
		if (redis.status === 'wait') {
			await connectRedis();
		}
		await prisma.event.upsert({
			where: { id: eventId },
			update: { name: 'Phase 4 Integration Event', startsAt: new Date('2026-12-20T18:00:00.000Z') },
			create: { id: eventId, name: 'Phase 4 Integration Event', startsAt: new Date('2026-12-20T18:00:00.000Z') },
		});
		await prisma.seat.upsert({
			where: { id: seatId },
			update: { status: 'AVAILABLE' },
			create: { id: seatId, eventId, section: 'TEST', row: 'A', number: '1', status: 'AVAILABLE' },
		});
		await redis.del(ORDER_STREAM_KEY);
		await redis.del(getSeatLockKey(eventId, seatId));
		await initializeOrderConsumerGroup();
	});

	afterAll(async (): Promise<void> => {
		await prisma.order.deleteMany({ where: { eventId } });
		await prisma.seat.deleteMany({ where: { id: seatId } });
		await prisma.event.delete({ where: { id: eventId } });
		if (redis.status === 'ready') {
			await redis.del(getSeatLockKey(eventId, seatId));
			await disconnectRedis();
		}
		await prisma.$disconnect();
	});

	it('publishes, consumes, acknowledges, and persists an order', async (): Promise<void> => {
		const order = await createOrder({ eventId, seatId, userId: 'phase-4-test-user' });
		const entries = await redis.xrange(ORDER_STREAM_KEY, '-', '+');
		expect(order.status).toBe('PROCESSING');
		expect(entries).toHaveLength(1);

		const processed = await processAvailableOrderMessages();
		const persisted = await prisma.order.findUnique({ where: { id: order.orderId } });
		const seat = await prisma.seat.findUnique({ where: { id: seatId } });
		const pending = await redis.xpending(ORDER_STREAM_KEY, ORDER_CONSUMER_GROUP) as unknown as [number, string | null, string | null, unknown[]];

		expect(processed).toBe(1);
		expect(persisted?.status).toBe('BOOKED');
		expect(seat?.status).toBe('SOLD');
		expect(pending[0]).toBe(0);
	});
});