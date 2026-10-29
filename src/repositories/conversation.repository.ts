import type { Pool } from 'pg';
import { HttpError } from '../middlewares/error.middleware';
import type { ChatMessage, ConversationSummary, MessageMetadata, PaginationInput, StoredMessage } from '../types/chat.types';
import { query } from '../config/database';

const messageColumns = 'id, conversation_id, parent_message_id, role, content, status, provider, model, created_at, updated_at';
export class ConversationRepository {
  constructor(private readonly db: Pool, private readonly userId: string, private readonly signal: AbortSignal) {}
  private async rows<Row extends Record<string, unknown>>(operation: string, sql: string, values: unknown[]) {
    return (await query<Row>(this.db, operation, sql, values, this.signal)).rows;
  }

  async listOwned({ limit, offset }: PaginationInput) {
    const rows = await this.rows<ConversationSummary>('conversations.listOwned',
      `SELECT id, user_id, title, model, created_at, updated_at, last_message_at
       FROM public.conversations WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3`, [this.userId, limit + 1, offset]);
    return { conversations: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit } };
  }

  async listMessages(id: string, { limit, offset }: PaginationInput) {
    await this.findOwned(id);
    const rows = await this.rows<StoredMessage>('messages.list',
      `SELECT ${messageColumns} FROM public.messages WHERE conversation_id = $1
       AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = $1 AND c.user_id = $2)
       ORDER BY created_at ASC, id ASC LIMIT $3 OFFSET $4`, [id, this.userId, limit + 1, offset]);
    return { conversation_id: id, messages: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit } };
  }

  async findOwned(id: string) {
    const rows = await this.rows<{ id: string }>('conversations.findOwned',
      'SELECT id FROM public.conversations WHERE id = $1 AND user_id = $2', [id, this.userId]);
    if (!rows[0]) throw new HttpError(404, 'Conversation không tồn tại hoặc bạn không có quyền truy cập.', 'conversation_not_found');
    return rows[0].id;
  }

  async create(title: string, model: string) {
    const rows = await this.rows<{ id: string }>('conversations.create',
      'INSERT INTO public.conversations (user_id, title, model) VALUES ($1, $2, $3) RETURNING id', [this.userId, title, model]);
    return rows[0].id;
  }

  async history(id: string): Promise<ChatMessage[]> {
    const rows = await this.rows<ChatMessage>('messages.history',
      `SELECT id, conversation_id, role, content, created_at FROM public.messages
       WHERE conversation_id = $1 AND status = 'completed' AND role IN ('user', 'assistant')
       AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = $1 AND c.user_id = $2)
       ORDER BY created_at DESC, id DESC LIMIT 40`, [id, this.userId]);
    const messages = rows.reverse();
    let characters = 0;
    let start = messages.length;
    while (start > 0 && characters + messages[start - 1].content.length <= 48000) characters += messages[--start].content.length;
    return messages.slice(start);
  }

  async addMessage(id: string, role: 'user' | 'assistant', content: string, details: MessageMetadata = {}): Promise<ChatMessage> {
    const rows = await this.rows<ChatMessage>('messages.insert',
      `INSERT INTO public.messages (conversation_id, role, content, status, parent_message_id, provider, model, response_id, input_tokens, output_tokens)
       SELECT $1, $3, $4, 'completed', $5, $6, $7, $8, $9, $10
       FROM public.conversations WHERE id = $1 AND user_id = $2
       RETURNING id, conversation_id, role, content, created_at`,
      [id, this.userId, role, content, details.parent_message_id ?? null, details.provider ?? null,
        details.model ?? null, details.response_id ?? null, details.input_tokens ?? null, details.output_tokens ?? null]);
    if (!rows[0]) throw new HttpError(404, 'Conversation không tồn tại hoặc bạn không có quyền truy cập.', 'conversation_not_found');
    return rows[0];
  }

  async touch(id: string) {
    await this.rows('conversations.touch',
      'UPDATE public.conversations SET updated_at = now(), last_message_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [id, this.userId]);
  }
}
