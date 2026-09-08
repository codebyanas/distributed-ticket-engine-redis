import type { NextFunction, Request, Response } from 'express';
import { jest } from '@jest/globals';

describe('rateLimiter middleware', (): void => {
	it('returns 429 when Redis reports that the request is not allowed', async (): Promise<void> => {
		const evalsha = jest.fn().mockResolvedValue([0, 0, Date.now() + 1_000, 4]);
		const getLuaScriptDigest = jest.fn().mockReturnValue('test-digest');

		jest.unstable_mockModule('../../src/config/redis.config.js', () => ({ redis: { evalsha } }));
		jest.unstable_mockModule('../../src/scripts/lua-loader.js', () => ({ getLuaScriptDigest }));

		const { rateLimiter } = await import('../../src/middlewares/rateLimiter.js');
		const request = { ip: '127.0.0.1', socket: {} } as Request;
		const response = {
			setHeader: jest.fn(),
			status: jest.fn().mockReturnThis(),
			json: jest.fn(),
		} as unknown as Response;
		const next = jest.fn() as unknown as NextFunction;

		await rateLimiter({ windowMs: 1_000, maxRequests: 3 })(request, response, next);

		expect(response.status).toHaveBeenCalledWith(429);
		expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
		expect(next).not.toHaveBeenCalled();
	});
});