import { Router } from 'express';
import type { Router as RouterType } from 'express';
import eventRouter from './event.routes.js';

const apiRouter: RouterType = Router();

apiRouter.use('/events', eventRouter);

export default apiRouter;
