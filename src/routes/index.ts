import { Router } from 'express';
import type { Router as RouterType } from 'express';
import eventRouter from './event.routes.js';
import diagnosticsRouter from './diagnostics.routes.js';

const apiRouter: RouterType = Router();

apiRouter.use('/events', eventRouter);
apiRouter.use('/diagnostics', diagnosticsRouter);

export default apiRouter;
