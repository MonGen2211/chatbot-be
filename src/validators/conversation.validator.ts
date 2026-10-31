import { HttpError } from '../middlewares/error.middleware';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateConversationId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'Conversation ID phải là UUID hợp lệ.', 'invalid_conversation_id');
  }
  return value;
}
