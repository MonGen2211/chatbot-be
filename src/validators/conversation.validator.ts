import { HttpError } from '../middlewares/error.middleware';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateConversationId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'Conversation ID phải là UUID hợp lệ.', 'invalid_conversation_id');
  }
  return value.toLowerCase();
}

export function validateConversationTitle(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body phải là JSON có title.', 'invalid_title');
  }
  const title = (body as Record<string, unknown>).title;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
    throw new HttpError(400, 'Title phải có từ 1 đến 200 ký tự.', 'invalid_title');
  }
  return title.trim();
}
