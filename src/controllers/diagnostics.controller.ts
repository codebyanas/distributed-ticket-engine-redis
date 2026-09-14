import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { BadRequestError } from '../utils/custom-errors.js';
import { runSeatingMapBenchmark } from '../services/diagnostics.service.js';

const benchmarkSchema = z.object({
	eventId: z.string().min(1),
	useRedis: z.boolean(),
	concurrency: z.number().int().min(1).max(100).default(50),
	clearCacheBeforeRun: z.boolean().default(true),
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