import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getConversationsController, renameConversationController, deleteConversationController } from '../controllers/conversation.controller';

export const conversationRouter = Router();
conversationRouter.get('/', requireAuth, getConversationsController);
conversationRouter.patch('/:conversation_id', requireAuth, renameConversationController);
conversationRouter.delete('/:conversation_id', requireAuth, deleteConversationController);
