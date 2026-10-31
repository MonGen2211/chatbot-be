import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { sendMessageController } from '../controllers/chat.controller';

export const chatRouter = Router();
chatRouter.post('/', requireAuth, sendMessageController);

// Keep POST /api/conversations/send-messages for existing FE clients.
export const legacyChatRouter = Router();
legacyChatRouter.post('/send-messages', requireAuth, sendMessageController);
