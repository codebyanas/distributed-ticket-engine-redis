import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { benchmarkSeatingMap } from '../controllers/diagnostics.controller.js';

const diagnosticsRouter: RouterType = Router();

diagnosticsRouter.post('/seating-map/benchmark', benchmarkSeatingMap);

export default diagnosticsRouter;