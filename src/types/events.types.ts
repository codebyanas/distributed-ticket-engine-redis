import { z } from 'zod';

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

export const WS_SEAT_EVENTS_CHANNEL = 'ws:seat-events';
export const WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION = 1;

export const seatHeldEventSchema = z.object({
	eventId: z.string().min(1),
	seatId: z.string().min(1),
	holdId: z.string().min(1),
	status: z.literal('HELD'),
	expiresAt: z.string().datetime(),
});

export const seatBookedEventSchema = z.object({
	eventId: z.string().min(1),
	seatId: z.string().min(1),
	orderId: z.string().min(1),
	status: z.literal('SOLD'),
});

export const seatReleasedEventSchema = z.object({
	eventId: z.string().min(1),
	seatId: z.string().min(1),
	holdId: z.string().min(1),
	status: z.literal('AVAILABLE'),
	reason: z.enum(['cancelled', 'expired', 'released']),
});

export const webSocketSeatEventSchema = z.discriminatedUnion('eventType', [
	z.object({
		eventId: z.string().uuid(),
		eventType: z.literal('seat.held'),
		schemaVersion: z.literal(WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION),
		occurredAt: z.string().datetime(),
		correlationId: z.string().min(1),
		payload: seatHeldEventSchema,
	}),
	z.object({
		eventId: z.string().uuid(),
		eventType: z.literal('seat.booked'),
		schemaVersion: z.literal(WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION),
		occurredAt: z.string().datetime(),
		correlationId: z.string().min(1),
		payload: seatBookedEventSchema,
	}),
	z.object({
		eventId: z.string().uuid(),
		eventType: z.literal('seat.released'),
		schemaVersion: z.literal(WEBSOCKET_SEAT_EVENT_SCHEMA_VERSION),
		occurredAt: z.string().datetime(),
		correlationId: z.string().min(1),
		payload: seatReleasedEventSchema,
	}),
]);

export type WebSocketSeatEvent = z.infer<typeof webSocketSeatEventSchema>;
export type SeatHeldEventPayload = z.infer<typeof seatHeldEventSchema>;
export type SeatBookedEventPayload = z.infer<typeof seatBookedEventSchema>;
export type SeatReleasedEventPayload = z.infer<typeof seatReleasedEventSchema>;

export const webSocketClientFrameSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('subscribe'), eventId: z.string().min(1) }),
	z.object({ type: z.literal('unsubscribe'), eventId: z.string().min(1) }),
]);

export type WebSocketClientFrame = z.infer<typeof webSocketClientFrameSchema>;
