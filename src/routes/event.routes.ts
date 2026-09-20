import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { getEventSeatingMap, searchEventsByGeo } from '../controllers/event.controller.js';

const eventRouter: RouterType = Router();

eventRouter.get('/search/geo', searchEventsByGeo);
eventRouter.get('/:eventId/seats', getEventSeatingMap);

export default eventRouter;