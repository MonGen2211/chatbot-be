import type { AuthContext } from '../middlewares/auth.middleware';
import { MessageRepository } from '../repositories/message.repository';
import { ConversationRepository } from '../repositories/conversation.repository';
import type { PaginationInput } from '../types/pagination.types';

export async function getMessages(auth: AuthContext, conversationId: string, pagination: PaginationInput, signal: AbortSignal) {
  await new ConversationRepository(auth.db, auth.userId, signal).findOwned(conversationId);
  return new MessageRepository(auth.db, auth.userId, signal).listMessages(conversationId, pagination);
}
