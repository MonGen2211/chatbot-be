import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getConversationsController, getMessagesController, sendMessageController } from '../controllers/conversation.controller';

export const conversationRouter = Router();
conversationRouter.get('/', requireAuth, getConversationsController);
conversationRouter.get('/:conversation_id/messages', requireAuth, getMessagesController);
conversationRouter.post('/send-messages', requireAuth, sendMessageController);
