import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getConversationsController } from '../controllers/conversation.controller';

export const conversationRouter = Router();
conversationRouter.get('/', requireAuth, getConversationsController);
