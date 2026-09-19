export const ORDER_STREAM_KEY = 'stream:orders';
export const ORDER_CONSUMER_GROUP = 'order-settlement-workers';
export const ORDER_EVENT_TYPE = 'order.created';
export const ORDER_EVENT_SCHEMA_VERSION = 1;

export interface OrderCreatedEventPayload {
	holdId: string;
	orderId: string;
	eventId: string;
	seatId: string;
	userId: string;
	expiresAt: string;
}

export interface StreamMessageEnvelope<TPayload> {
	eventId: string;
	eventType: string;
	schemaVersion: number;
	occurredAt: string;
	payload: TPayload;
}

export type OrderCreatedEvent = StreamMessageEnvelope<OrderCreatedEventPayload>;

export interface RedisStreamMessage {
	id: string;
	fields: Readonly<Record<string, string>>;
}
