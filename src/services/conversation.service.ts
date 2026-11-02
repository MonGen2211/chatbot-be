import type { AuthContext } from '../middlewares/auth.middleware';
import { ConversationRepository } from '../repositories/conversation.repository';
import type { PaginationInput } from '../types/pagination.types';

export function getConversations(auth: AuthContext, pagination: PaginationInput, signal: AbortSignal) {
  return new ConversationRepository(auth.db, auth.userId, signal).listOwned(pagination);
}

export function renameConversation(auth: AuthContext, id: string, title: string, signal: AbortSignal) {
  return new ConversationRepository(auth.db, auth.userId, signal).rename(id, title);
}

export function deleteConversation(auth: AuthContext, id: string, signal: AbortSignal) {
  return new ConversationRepository(auth.db, auth.userId, signal).delete(id);
}
