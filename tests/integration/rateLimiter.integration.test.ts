import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { redis } from '../../src/config/redis.config.js';
import app from '../../src/app.js';
import { loadLuaScripts } from '../../src/scripts/lua-loader.js';

describe('Redis rate limiter HTTP integration', (): void => {
	beforeAll(async (): Promise<void> => {
		await redis.connect();
		await redis.flushdb();
		await loadLuaScripts(redis);
	});

	afterAll(async (): Promise<void> => {
		await redis.flushdb();
		await redis.quit();
	});

	it('allows configured requests and rejects the next request with 429', async (): Promise<void> => {
		const responses = await Promise.all(
			Array.from({ length: 4 }, async (): Promise<request.Response> =>
				request(app).get('/api/v1/rate-limit-test'),
			),
		);

		const successfulResponses = responses.filter((response) => response.status === 200);
		const rateLimitedResponses = responses.filter((response) => response.status === 429);

		expect(successfulResponses).toHaveLength(3);
		expect(rateLimitedResponses).toHaveLength(1);
		expect(rateLimitedResponses[0]?.headers['retry-after']).toBeDefined();
	});
});