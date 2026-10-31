import { HttpError } from '../middlewares/error.middleware';
import type { SendMessageInput } from '../types/chat.types';
import { validateConversationId } from './conversation.validator';

export function validateSendMessage(body: unknown): SendMessageInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body phải là JSON.', 'invalid_message');
  }
  const input = body as Record<string, unknown>;
  const message = input.message;
  // Accept the spelling used by the existing FE as an alias.
  if (input.conversation_id != null && input.conservation_id != null && input.conversation_id !== input.conservation_id) {
    throw new HttpError(400, 'Hai conversation ID không khớp.', 'invalid_conversation_id');
  }
  const id = input.conversation_id ?? input.conservation_id;
  if (typeof message !== 'string' || !message.trim() || message.length > 12000) {
    throw new HttpError(400, 'Message phải có từ 1 đến 12000 ký tự và không chỉ chứa khoảng trắng.', 'invalid_message');
  }
  if (id != null) validateConversationId(id);
  return { message, ...(typeof id === 'string' ? { conversation_id: id } : {}) };
}
