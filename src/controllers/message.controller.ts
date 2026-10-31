import type { RequestHandler } from 'express';
import type { AuthContext } from '../middlewares/auth.middleware';
import { getMessages } from '../services/message.service';
import { validateConversationId } from '../validators/conversation.validator';
import { validatePagination } from '../validators/pagination.validator';

export const getMessagesController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const conversationId = validateConversationId(req.params.conversation_id ?? req.query.conversation_id);
  const pagination = validatePagination(req.query);
  const data = await getMessages(res.locals.auth as AuthContext, conversationId, pagination, AbortSignal.timeout(15000));
  res.status(200).json({ success: true, data });
};
