import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { WebSocket } from 'ws';
import { connectRedis, disconnectRedis, redis } from '../../src/config/redis.config.js';
import { RedisPubSubAdapter } from '../../src/websocket/pubsub.adapter.js';
import { startWebSocketServer } from '../../src/websocket/socket.server.js';
import type { WebSocketSeatEvent } from '../../src/types/events.types.js';

const waitForMessage = (socket: WebSocket, predicate: (message: string) => boolean): Promise<string> => new Promise((resolve, reject) => {
	const timeout = setTimeout(() => {
		socket.off('message', onMessage);
		reject(new Error('Timed out waiting for WebSocket message'));
	}, 2_000);
	const onMessage = (data: Buffer): void => {
		const message = data.toString();
		if (!predicate(message)) {
			return;
		}
		clearTimeout(timeout);
		socket.off('message', onMessage);
		resolve(message);
	};
	socket.on('message', onMessage);
});

const listen = async (server: http.Server): Promise<number> => {
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('Test server did not expose a TCP address');
	}
	return address.port;
};

describe('WebSocket Redis Pub/Sub backplane', (): void => {
	let nodeA: { server: http.Server; close: () => Promise<void> };
	let nodeB: { server: http.Server; close: () => Promise<void> };
	let adapterA: RedisPubSubAdapter;
	let adapterB: RedisPubSubAdapter;
	let clientA: WebSocket;
	let clientB: WebSocket;

	beforeAll(async (): Promise<void> => {
		if (redis.status === 'wait') {
			await connectRedis();
		}
		adapterA = new RedisPubSubAdapter(redis);
		adapterB = new RedisPubSubAdapter(redis);
		const serverA = http.createServer();
		const serverB = http.createServer();
		const lifecycleA = await startWebSocketServer(serverA, adapterA);
		const lifecycleB = await startWebSocketServer(serverB, adapterB);
		nodeA = { server: serverA, close: lifecycleA.close };
		nodeB = { server: serverB, close: lifecycleB.close };
		const portA = await listen(serverA);
		const portB = await listen(serverB);
		clientA = new WebSocket(`ws://127.0.0.1:${portA}/ws`);
		clientB = new WebSocket(`ws://127.0.0.1:${portB}/ws`);
		await Promise.all([
			new Promise<void>((resolve) => clientA.once('open', resolve)),
			new Promise<void>((resolve) => clientB.once('open', resolve)),
		]);
	});

	afterAll(async (): Promise<void> => {
		clientA.close();
		clientB.close();
		await nodeA.close();
		await nodeB.close();
		await Promise.all([
			new Promise<void>((resolve) => nodeA.server.close(() => resolve())),
			new Promise<void>((resolve) => nodeB.server.close(() => resolve())),
		]);
		if (redis.status === 'ready') {
			await disconnectRedis();
		}
	});

	it('propagates a seat event between nodes and isolates rooms', async (): Promise<void> => {
		clientA.send(JSON.stringify({ type: 'subscribe', eventId: 'event-a' }));
		clientB.send(JSON.stringify({ type: 'subscribe', eventId: 'event-b' }));
		await Promise.all([
			waitForMessage(clientA, (message) => message.includes('subscription.confirmed')),
			waitForMessage(clientB, (message) => message.includes('subscription.confirmed')),
		]);

		const event: WebSocketSeatEvent = {
			eventId: 'd6f2b05e-77c9-4c01-9a17-3e8bfae5d4de',
			eventType: 'seat.held',
			schemaVersion: 1,
			occurredAt: new Date().toISOString(),
			correlationId: 'phase-5-test-hold',
			payload: {
				eventId: 'event-a',
				seatId: 'seat-a',
				holdId: 'hold-a',
				status: 'HELD',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			},
		};
		const received = waitForMessage(clientA, (message) => message.includes('seat.held'));
		await adapterA.publishSeatEvent(event);
		await expect(received).resolves.toContain('seat-a');

		let isolatedMessage = false;
		const onUnexpectedMessage = (data: Buffer): void => {
			if (data.toString().includes('seat-a')) {
				isolatedMessage = true;
			}
		};
		clientB.on('message', onUnexpectedMessage);
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
		clientB.off('message', onUnexpectedMessage);
		expect(isolatedMessage).toBe(false);
	});
});