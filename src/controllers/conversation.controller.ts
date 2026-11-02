import type { RequestHandler } from 'express';
import type { AuthContext } from '../middlewares/auth.middleware';
import { getConversations, renameConversation, deleteConversation } from '../services/conversation.service';
import { validatePagination } from '../validators/pagination.validator';
import { validateConversationId, validateConversationTitle } from '../validators/conversation.validator';

export const getConversationsController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pagination = validatePagination(req.query);
  const data = await getConversations(res.locals.auth as AuthContext, pagination, AbortSignal.timeout(15000));
  res.status(200).json({ success: true, data });
};

export const renameConversationController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = validateConversationId(req.params.conversation_id);
  const title = validateConversationTitle(req.body);
  const data = await renameConversation(res.locals.auth as AuthContext, id, title, AbortSignal.timeout(15000));
  res.status(200).json({ success: true, data });
};

export const deleteConversationController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = validateConversationId(req.params.conversation_id);
  const data = await deleteConversation(res.locals.auth as AuthContext, id, AbortSignal.timeout(15000));
  res.status(200).json({ success: true, data });
};
