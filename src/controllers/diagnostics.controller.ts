import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/custom-errors.js';
import {
	runOrderStreamBenchmark,
	runSeatHoldBenchmark,
	runSeatingMapBenchmark,
} from '../services/diagnostics.service.js';

const benchmarkSchema = z.object({
	eventId: z.string().min(1),
	useRedis: z.boolean(),
	concurrency: z.number().int().min(1).max(100).default(50),
	clearCacheBeforeRun: z.boolean().default(true),
});

const seatHoldBenchmarkSchema = z.object({
	eventId: z.string().min(1),
	seatId: z.string().min(1),
	concurrency: z.number().int().min(1).max(100).default(50),
});

const orderStreamBenchmarkSchema = z.object({
	eventId: z.string().min(1),
	seatIds: z.array(z.string().min(1)).min(1).max(100),
	userIdPrefix: z.string().min(1).default('benchmark-user'),
});

/**
 * Runs the development-only Phase 2 seating-map benchmark.
 *
 * @param request - Express request containing the benchmark JSON body.
 * @param response - Express response used to return aggregate evidence.
 * @returns Promise resolving after the benchmark report is sent.
 * @concurrency Impact: Executes the requested concurrent reads to measure mutex protection.
 * @complexity Time: O(C) for C concurrent diagnostic requests.
 */
export const benchmarkSeatingMap = async (request: Request, response: Response): Promise<void> => {
	if (env.NODE_ENV === 'production') {
		throw new BadRequestError('Diagnostic benchmark is disabled in production');
	}
	const parsed = benchmarkSchema.safeParse(request.body);
	if (!parsed.success) {
		throw new BadRequestError('Invalid benchmark body');
	}
	const report = await runSeatingMapBenchmark(parsed.data);
	response.status(200).json(report);
};

/**
 * Runs the Phase 3 atomic seat-hold concurrency benchmark.
 *
 * @param request - Express request containing the target seat and concurrency.
 * @param response - Express response used to return aggregate Redis Lua evidence.
 * @returns Promise resolving after the benchmark report is sent.
 * @concurrency Impact: Delegates concurrent check-and-set attempts to the atomic Redis Lua engine.
 * @complexity Time: O(C) for C concurrent attempts.
 */
export const benchmarkSeatHold = async (request: Request, response: Response): Promise<void> => {
	if (env.NODE_ENV === 'production') {
		throw new BadRequestError('Diagnostic benchmark is disabled in production');
	}
	const parsed = seatHoldBenchmarkSchema.safeParse(request.body);
	if (!parsed.success) {
		throw new BadRequestError('Invalid seat hold benchmark body');
	}
	const report = await runSeatHoldBenchmark(parsed.data);
	response.status(200).json(report);
};

/**
 * Runs the development-only Phase 4 stream publication and settlement benchmark.
 *
 * @param request - Express request containing the event and available benchmark seats.
 * @param response - Express response used to return stream and database metrics.
 * @returns Promise resolving after the benchmark report is sent.
 * @concurrency Impact: Concurrent producers exercise Redis Streams and the idempotent worker transaction.
 * @complexity O(C) for C requested seats.
 */
export const benchmarkOrderStream = async (request: Request, response: Response): Promise<void> => {
	if (env.NODE_ENV === 'production') {
		throw new BadRequestError('Diagnostic benchmark is disabled in production');
	}
	const parsed = orderStreamBenchmarkSchema.safeParse(request.body);
	if (!parsed.success) {
		throw new BadRequestError('Invalid order stream benchmark body');
	}
	const report = await runOrderStreamBenchmark(parsed.data);
	response.status(200).json(report);
};