import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { benchmarkSeatHold, benchmarkSeatingMap } from '../controllers/diagnostics.controller.js';

const diagnosticsRouter: RouterType = Router();

diagnosticsRouter.post('/seating-map/benchmark', benchmarkSeatingMap);
diagnosticsRouter.post('/seat-hold/benchmark', benchmarkSeatHold);

export default diagnosticsRouter;