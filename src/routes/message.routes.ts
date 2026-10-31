import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getMessagesController } from '../controllers/message.controller';

export const messageRouter = Router();
messageRouter.get('/', requireAuth, getMessagesController);

// Keep GET /api/conversations/:conversation_id/messages for existing FE clients.
export const legacyMessageRouter = Router({ mergeParams: true });
legacyMessageRouter.get('/', requireAuth, getMessagesController);
