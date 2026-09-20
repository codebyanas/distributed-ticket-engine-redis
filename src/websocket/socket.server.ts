import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { logger } from '../utils/logger.js';
import { webSocketClientFrameSchema, type WebSocketClientFrame, type WebSocketSeatEvent } from '../types/events.types.js';
import { pubSubAdapter, type RedisPubSubAdapter, type SeatEventListener } from './pubsub.adapter.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const WEBSOCKET_PATH = '/ws';

interface SocketState {
	isAlive: boolean;
	eventIds: Set<string>;
}

const states = new WeakMap<WebSocket, SocketState>();

const removeFromRooms = (socket: WebSocket, rooms: Map<string, Set<WebSocket>>): void => {
	const state = states.get(socket);
	if (state === undefined) {
		return;
	}
	for (const eventId of state.eventIds) {
		const room = rooms.get(eventId);
		room?.delete(socket);
		if (room?.size === 0) {
			rooms.delete(eventId);
		}
	}
	state.eventIds.clear();
};

const parseFrame = (data: RawData): WebSocketClientFrame | null => {
	try {
		const parsed = JSON.parse(data.toString()) as unknown;
		const result = webSocketClientFrameSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch (_error: unknown) {
		return null;
	}
};

/**
 * Starts a WebSocket server on the native HTTP server and connects its Redis backplane.
 *
 * @param server - Native HTTP server shared with Express.
 * @returns Promise resolving to the WebSocket server and shutdown function.
 * @concurrency Impact: Room membership is process-local while Pub/Sub synchronizes events across containers.
 * @complexity O(C + R) for C connections and R subscribed rooms during shutdown.
 */
export const startWebSocketServer = async (
	server: http.Server,
	adapter: RedisPubSubAdapter = pubSubAdapter,
): Promise<{ server: WebSocketServer; close: () => Promise<void> }> => {
	const rooms = new Map<string, Set<WebSocket>>();
	const webSocketServer = new WebSocketServer({ noServer: true });
	const onSeatEvent = (event: WebSocketSeatEvent): void => {
		const room = rooms.get(event.payload.eventId);
		if (room === undefined) {
			return;
		}
		const message = JSON.stringify(event);
		for (const socket of room) {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(message);
			} else {
				removeFromRooms(socket, rooms);
			}
		}
	};

	const listener: SeatEventListener = onSeatEvent;
	await adapter.connect(listener);

	server.on('upgrade', (request, socket, head): void => {
		const requestUrl = new URL(request.url ?? '/', 'http://localhost');
		if (requestUrl.pathname !== WEBSOCKET_PATH) {
			socket.destroy();
			return;
		}
		webSocketServer.handleUpgrade(request, socket, head, (client: WebSocket): void => {
			webSocketServer.emit('connection', client, request);
		});
	});

	webSocketServer.on('connection', (socket: WebSocket): void => {
		states.set(socket, { isAlive: true, eventIds: new Set<string>() });
		socket.on('pong', (): void => {
			const state = states.get(socket);
			if (state !== undefined) {
				state.isAlive = true;
			}
		});
		socket.on('message', (data: RawData): void => {
			const frame = parseFrame(data);
			if (frame === null) {
				socket.send(JSON.stringify({ type: 'error', message: 'Invalid WebSocket command' }));
				return;
			}
			const state = states.get(socket);
			if (state === undefined) {
				return;
			}
			if (frame.type === 'subscribe') {
				const room = rooms.get(frame.eventId) ?? new Set<WebSocket>();
				room.add(socket);
				rooms.set(frame.eventId, room);
				state.eventIds.add(frame.eventId);
				socket.send(JSON.stringify({ type: 'subscription.confirmed', eventId: frame.eventId }));
				return;
			}
			const room = rooms.get(frame.eventId);
			room?.delete(socket);
			state.eventIds.delete(frame.eventId);
			if (room?.size === 0) {
				rooms.delete(frame.eventId);
			}
			socket.send(JSON.stringify({ type: 'unsubscription.confirmed', eventId: frame.eventId }));
		});
		socket.on('close', (): void => removeFromRooms(socket, rooms));
		socket.on('error', (error: Error): void => logger.warn({ err: error }, 'WebSocket client error'));
	});

	const heartbeat = setInterval((): void => {
		for (const socket of webSocketServer.clients) {
			const state = states.get(socket);
			if (state?.isAlive !== true) {
				removeFromRooms(socket, rooms);
				socket.terminate();
				continue;
			}
			state.isAlive = false;
			socket.ping();
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref();

	return {
		server: webSocketServer,
		close: async (): Promise<void> => {
			clearInterval(heartbeat);
			for (const socket of webSocketServer.clients) {
				removeFromRooms(socket, rooms);
				socket.close();
			}
			await adapter.disconnect();
			await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
		},
	};
};