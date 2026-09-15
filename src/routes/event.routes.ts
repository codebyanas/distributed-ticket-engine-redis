import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { getEventSeatingMap } from '../controllers/event.controller.js';

const eventRouter: RouterType = Router();

eventRouter.get('/:eventId/seats', getEventSeatingMap);

export default eventRouter;