import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { createOrderHandler, holdSeatHandler, releaseSeatHandler } from '../controllers/ticket.controller.js';

const ticketRouter: RouterType = Router();

ticketRouter.post('/hold', holdSeatHandler);
ticketRouter.post('/orders', createOrderHandler);
ticketRouter.post('/release', releaseSeatHandler);

export default ticketRouter;
