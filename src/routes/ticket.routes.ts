import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { createOrderHandler, holdSeatHandler } from '../controllers/ticket.controller.js';

const ticketRouter: RouterType = Router();

ticketRouter.post('/hold', holdSeatHandler);
ticketRouter.post('/orders', createOrderHandler);

export default ticketRouter;
