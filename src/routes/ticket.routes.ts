import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { holdSeatHandler } from '../controllers/ticket.controller.js';

const ticketRouter: RouterType = Router();

ticketRouter.post('/hold', holdSeatHandler);

export default ticketRouter;
