import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { prisma } from '../config/database.config.js';
import { redis } from '../config/redis.config.js';
import { logger } from '../utils/logger.js';
import {
	ORDER_CONSUMER_GROUP,
	ORDER_EVENT_TYPE,
	ORDER_STREAM_KEY,
	type OrderCreatedEventPayload,
	type RedisStreamMessage,
} from '../types/events.types.js';

type RawStreamResult = Array<[string, Array<[string, string[]]>]>;
type RawAutoClaimResult = [string, Array<[string, string[]]>, string[]];

const CLAIM_IDLE_MS = 30_000;
const POLL_BLOCK_MS = 1_000;
const BATCH_SIZE = 10;

const consumerName = `order-worker-${process.pid}-${randomUUID()}`;
let consumerRunning = false;

const toMessage = (raw: [string, string[]]): RedisStreamMessage => {
	const fields: Record<string, string> = {};
	for (let index = 0; index < raw[1].length; index += 2) {
		const key = raw[1][index];
		const value = raw[1][index + 1];
		if (key !== undefined && value !== undefined) {
			fields[key] = value;
		}
	}
	return { id: raw[0], fields };
};

const parsePayload = (message: RedisStreamMessage): OrderCreatedEventPayload => {
    const rawPayload = message.fields.payload;

    if (rawPayload === undefined) {
        throw new Error(`Missing order event payload: ${message.id}`);
    }

    const payload = JSON.parse(rawPayload) as Partial<OrderCreatedEventPayload>;

    if (
        typeof payload.holdId !== 'string'
        || typeof payload.orderId !== 'string'
        || typeof payload.eventId !== 'string'
        || typeof payload.seatId !== 'string'
        || typeof payload.userId !== 'string'
        || typeof payload.expiresAt !== 'string'
    ) {
        throw new Error(`Invalid order event payload: ${message.id}`);
    }

    return payload as OrderCreatedEventPayload;
};

/**
 * Ensures the order consumer group exists and is safe to initialize repeatedly.
 *
 * @param client - Redis client used for stream administration.
 * @returns Promise resolving after group initialization.
 * @concurrency Impact: Redis creates the group once; BUSYGROUP is treated as an idempotent startup result.
 * @complexity Time: O(1) Redis metadata operation.
 */
export const initializeOrderConsumerGroup = async (client: Redis = redis): Promise<void> => {
	try {
		await client.xgroup('CREATE', ORDER_STREAM_KEY, ORDER_CONSUMER_GROUP, '$', 'MKSTREAM');
	} catch (error: unknown) {
		if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
			throw error;
		}
	}
};

const settleOrder = async (payload: OrderCreatedEventPayload): Promise<void> => {
	await prisma.$transaction(async (transaction): Promise<void> => {
		const existing = await transaction.order.findUnique({ where: { holdId: payload.holdId } });
		if (existing?.status === 'BOOKED') {
			return;
		}
		if (existing === null) {
			throw new Error(`Order not found for hold: ${payload.holdId}`);
		}

		const updatedSeat = await transaction.seat.updateMany({
			where: { id: payload.seatId, eventId: payload.eventId, status: 'HELD' },
			data: { status: 'SOLD' },
		});
		if (updatedSeat.count !== 1) {
			throw new Error(`Held seat was not available for order: ${payload.orderId}`);
		}
		await transaction.order.update({
			where: { holdId: payload.holdId },
			data: { status: 'BOOKED' },
		});
	});
};

const processMessage = async (client: Redis, message: RedisStreamMessage): Promise<void> => {
	try {
		if (message.fields.eventType !== ORDER_EVENT_TYPE || message.fields.schemaVersion !== '1') {
			throw new Error(`Unsupported order event: ${message.id}`);
		}
		await settleOrder(parsePayload(message));
		await client.xack(ORDER_STREAM_KEY, ORDER_CONSUMER_GROUP, message.id);
	} catch (error: unknown) {
		logger.error({ err: error, streamMessageId: message.id }, 'Order stream message processing failed');
	}
};

const readMessages = async (client: Redis, blockMs: number): Promise<RedisStreamMessage[]> => {
	const result = await client.xreadgroup(
		'GROUP', ORDER_CONSUMER_GROUP, consumerName,
		'COUNT', BATCH_SIZE, 'BLOCK', blockMs,
		'STREAMS', ORDER_STREAM_KEY, '>',
	) as unknown as RawStreamResult | null;
	if (result === null) {
		return [];
	}
	return result.flatMap((stream) => stream[1].map(toMessage));
};

const claimPendingMessages = async (client: Redis): Promise<RedisStreamMessage[]> => {
	const result = await client.call(
		'XAUTOCLAIM', ORDER_STREAM_KEY, ORDER_CONSUMER_GROUP, consumerName,
		CLAIM_IDLE_MS, '0-0', 'COUNT', BATCH_SIZE,
	) as unknown as RawAutoClaimResult;
	return result[1].map(toMessage);
};

/**
 * Processes currently available order events without blocking, for diagnostics and controlled drains.
 *
 * @param client - Redis client used to read and acknowledge events.
 * @returns Number of successfully handled messages in this drain.
 * @concurrency Impact: Database settlement is idempotent by unique holdId and acknowledgements follow commits.
 * @complexity O(M) for M messages in the bounded batch.
 */
export const processAvailableOrderMessages = async (client: Redis = redis): Promise<number> => {
	await initializeOrderConsumerGroup(client);
	const messages = [...await claimPendingMessages(client), ...await readMessages(client, 1)];
	await Promise.all(messages.map((message) => processMessage(client, message)));
	return messages.length;
};

/**
 * Starts the long-running order stream consumer loop.
 *
 * @param client - Redis client used by the worker.
 * @returns Promise resolving when the worker has stopped.
 * @concurrency Impact: At-least-once delivery is preserved by leaving failed messages in the PEL.
 * @complexity O(M) per batch of M messages.
 */
export const startOrderConsumer = async (client: Redis = redis): Promise<void> => {
	if (consumerRunning) {
		return;
	}
	consumerRunning = true;
	await initializeOrderConsumerGroup(client);
	try {
		while (consumerRunning) {
			const messages = [...await claimPendingMessages(client), ...await readMessages(client, POLL_BLOCK_MS)];
			if (messages.length === 0) {
				continue;
			}
			await Promise.all(messages.map((message) => processMessage(client, message)));
		}
	} finally {
		consumerRunning = false;
	}
};

/**
 * Requests a running consumer to stop after its current poll and batch finish.
 *
 * @returns Promise resolving after the stop request is recorded.
 * @concurrency Impact: Prevents new polls while allowing the current database batch to finish.
 * @complexity O(1) local state update.
 */
export const stopOrderConsumer = async (): Promise<void> => {
	consumerRunning = false;
};