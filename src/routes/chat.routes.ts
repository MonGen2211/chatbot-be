import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { sendMessageController, retryMessageController, editMessageController } from '../controllers/chat.controller';

export const chatRouter = Router();
chatRouter.post('/', requireAuth, sendMessageController);
chatRouter.post('/messages/:message_id/retry', requireAuth, retryMessageController);
chatRouter.patch('/messages/:message_id', requireAuth, editMessageController);

// Keep POST /api/conversations/send-messages for existing FE clients.
export const legacyChatRouter = Router();
legacyChatRouter.post('/send-messages', requireAuth, sendMessageController);
