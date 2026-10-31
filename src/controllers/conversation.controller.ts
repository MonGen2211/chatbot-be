import type { RequestHandler } from 'express';
import type { AuthContext } from '../middlewares/auth.middleware';
import { getConversations } from '../services/conversation.service';
import { validatePagination } from '../validators/pagination.validator';

export const getConversationsController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pagination = validatePagination(req.query);
  const data = await getConversations(res.locals.auth as AuthContext, pagination, AbortSignal.timeout(15000));
  res.status(200).json({ success: true, data });
};
