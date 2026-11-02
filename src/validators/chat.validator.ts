import { HttpError } from '../middlewares/error.middleware';
import type { SendMessageInput } from '../types/chat.types';
import { validateConversationId } from './conversation.validator';

export function validateMessageId(value: unknown): string {
  try { return validateConversationId(value); }
  catch { throw new HttpError(400, 'Message ID phải là UUID hợp lệ do client tạo.', 'invalid_message_id'); }
}

export function validateSendMessage(body: unknown): SendMessageInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body phải là JSON.', 'invalid_message');
  }
  const input = body as Record<string, unknown>;
  const messageId = validateMessageId(input.message_id ?? input.id);
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
  return { message_id: messageId, message, ...(typeof id === 'string' ? { conversation_id: id } : {}) };
}

export function validateEditMessage(body: unknown): string {
  const input = body as Record<string, unknown> | null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.message !== 'string'
    || !input.message.trim() || input.message.length > 12000) {
    throw new HttpError(400, 'Message phải có từ 1 đến 12000 ký tự và không chỉ chứa khoảng trắng.', 'invalid_message');
  }
  return input.message;
}
