import type { Redis } from 'ioredis';
import { redis } from '../config/redis.config.js';
import { logger } from '../utils/logger.js';
import {
	WS_SEAT_EVENTS_CHANNEL,
	webSocketSeatEventSchema,
	type WebSocketSeatEvent,
} from '../types/events.types.js';

export type SeatEventListener = (event: WebSocketSeatEvent) => void;

class RedisPubSubAdapter {
	private readonly publisher: Redis;
	private readonly subscriber: Redis;
	private listener: SeatEventListener | null = null;
	private connected = false;

	public constructor(commandClient: Redis = redis) {
		this.publisher = commandClient.duplicate();
		this.subscriber = commandClient.duplicate();
		this.subscriber.on('error', (error: Error): void => {
			logger.error({ err: error }, 'Redis WebSocket subscriber error');
		});
		this.publisher.on('error', (error: Error): void => {
			logger.error({ err: error }, 'Redis WebSocket publisher error');
		});
	}

	/**
	 * Connects dedicated publisher and subscriber clients and subscribes to the shared seat channel.
	 *
	 * @param listener - Callback invoked for validated events received from Redis.
	 * @returns Promise resolving when both clients are ready and subscribed.
	 * @concurrency Impact: One subscriber per process receives each event once and dispatches it locally.
	 * @complexity Time: O(1) Redis connection and subscription operations.
	 */
	public async connect(listener: SeatEventListener): Promise<void> {
		if (this.connected) {
			this.listener = listener;
			return;
		}
		this.listener = listener;
		if (this.publisher.status === 'wait') {
			await this.publisher.connect();
		}
		if (this.subscriber.status === 'wait') {
			await this.subscriber.connect();
		}
		this.subscriber.on('message', (channel: string, rawMessage: string): void => {
			if (channel !== WS_SEAT_EVENTS_CHANNEL || this.listener === null) {
				return;
			}
			let rawEvent: unknown;
			try {
				rawEvent = JSON.parse(rawMessage) as unknown;
			} catch (error: unknown) {
				logger.warn({ channel, err: error }, 'Ignored malformed WebSocket seat event');
				return;
			}
			const parsed = webSocketSeatEventSchema.safeParse(rawEvent);
			if (!parsed.success) {
				logger.warn({ channel }, 'Ignored invalid WebSocket seat event');
				return;
			}
			this.listener(parsed.data);
		});
		await this.subscribeToChannel();
		this.connected = true;
	}

	/**
	 * Subscribes the dedicated Redis client to the shared WebSocket event channel.
	 *
	 * @returns Promise resolving after Redis confirms the subscription.
	 * @concurrency Impact: Maintains one process-level subscription for all local WebSocket rooms.
	 * @complexity Time: O(1).
	 */
	public async subscribeToChannel(): Promise<void> {
		await this.subscriber.subscribe(WS_SEAT_EVENTS_CHANNEL);
	}

	/**
	 * Publishes a validated seat event to every application container.
	 *
	 * @param event - Strongly typed seat state event.
	 * @returns Promise resolving after Redis accepts the message.
	 * @concurrency Impact: Pub/Sub fan-out is non-blocking for local WebSocket delivery and does not mutate authoritative state.
	 * @complexity Time: O(N) in Redis subscriber count.
	 */
	public async publishSeatEvent(event: WebSocketSeatEvent): Promise<void> {
		await this.publisher.publish(WS_SEAT_EVENTS_CHANNEL, JSON.stringify(event));
	}

	/**
	 * Disconnects the dedicated Pub/Sub clients during graceful shutdown.
	 *
	 * @returns Promise resolving after both connections close.
	 * @concurrency Impact: Stops new cross-container notifications before process resources are released.
	 * @complexity Time: O(1).
	 */
	public async disconnect(): Promise<void> {
		this.listener = null;
		this.connected = false;
		if (this.subscriber.status !== 'end') {
			await this.subscriber.quit();
		}
		if (this.publisher.status !== 'end') {
			await this.publisher.quit();
		}
	}
}

export const pubSubAdapter = new RedisPubSubAdapter();
export { RedisPubSubAdapter };