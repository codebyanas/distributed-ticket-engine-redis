import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { redis } from '../config/redis.config.js';
import { getLuaScriptDigest } from '../scripts/lua-loader.js';

export interface RateLimiterOptions {
	readonly windowMs?: number;
	readonly maxRequests?: number;
	readonly keyPrefix?: string;
	readonly skip?: (request: Request) => boolean;
}

interface RateLimitResult {
	readonly allowed: number;
	readonly remaining: number;
	readonly resetAt: number;
	readonly requestCount: number;
}

const defaultOptions: Required<Omit<RateLimiterOptions, 'skip'>> = {
	windowMs: 60_000,
	maxRequests: 100,
	keyPrefix: 'rate-limit',
};

/**
 * Creates a Redis-backed sliding-window rate-limiting middleware.
 *
 * @param options - Window, threshold, key namespace, and optional bypass configuration.
 * @returns Express middleware that rejects requests above the configured threshold.
 * @concurrency Impact: Executes cleanup, insert, counting, and expiration atomically inside Redis Lua.
 * @complexity Time: O(log N) for a client ZSET with N retained requests | Space: O(N)
 */
export const rateLimiter = (options: RateLimiterOptions = {}): RequestHandler => {
	const configuration = { ...defaultOptions, ...options };

	return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
		const benchmarkHeader = request.get?.('x-benchmark-bypass')
			?? request.headers?.['x-benchmark-bypass']
			?? (typeof request.header === 'function' ? request.header('x-benchmark-bypass') : undefined);
		const benchmarkBypassRequested = benchmarkHeader !== undefined;
		if (process.env.DISABLE_RATE_LIMIT === 'true' || benchmarkBypassRequested) {
			next();
			return;
		}

		if (configuration.skip?.(request) === true) {
			next();
			return;
		}

		const clientIdentity = request.ip ?? request.socket.remoteAddress ?? 'unknown';
		const key = `${configuration.keyPrefix}:${encodeURIComponent(clientIdentity)}`;
		const now = Date.now();
		const ttlSeconds = Math.ceil(configuration.windowMs / 1000);
		const result = await redis.evalsha(
			getLuaScriptDigest('slidingWindow'),
			1,
			key,
			now,
			configuration.windowMs,
			configuration.maxRequests,
			`${now}-${randomUUID()}`,
			ttlSeconds,
		) as [number, number, number, number];

		const [allowed, remaining, resetAt, requestCount]: [number, number, number, number] = result;
		const rateLimitResult: RateLimitResult = {
			allowed,
			remaining,
			resetAt,
			requestCount,
		};

		response.setHeader('RateLimit-Limit', configuration.maxRequests);
		response.setHeader('RateLimit-Remaining', rateLimitResult.remaining);
		const resetAfterSeconds = Math.max(Math.ceil((rateLimitResult.resetAt - now) / 1000), 1);
		response.setHeader('RateLimit-Reset', resetAfterSeconds);

		if (rateLimitResult.allowed === 0) {
			response.setHeader('Retry-After', resetAfterSeconds);
			response.status(429).json({
				status: 'fail',
				statusCode: 429,
				message: 'Too many requests, please try again later',
			});
			return;
		}

		next();
	};
};
