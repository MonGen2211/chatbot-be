import type { Pool } from 'pg';
import { HttpError } from '../middlewares/error.middleware';
import type { ChatMessage, MessageMetadata, StoredMessage } from '../types/message.types';
import type { PaginationInput } from '../types/pagination.types';
import { query } from '../config/database';

const messageColumns = 'id, conversation_id, parent_message_id, role, content, status, provider, model, created_at, updated_at';
export class MessageRepository {
  constructor(private readonly db: Pool, private readonly userId: string, private readonly signal: AbortSignal) {}
  private async rows<Row extends Record<string, unknown>>(operation: string, sql: string, values: unknown[]) {
    return (await query<Row>(this.db, operation, sql, values, this.signal)).rows;
  }

  async listMessages(id: string, { limit, offset }: PaginationInput) {
    const rows = await this.rows<StoredMessage>('messages.list',
      `SELECT ${messageColumns} FROM public.messages WHERE conversation_id = $1
       AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = $1 AND c.user_id = $2)
       ORDER BY created_at ASC, id ASC LIMIT $3 OFFSET $4`, [id, this.userId, limit + 1, offset]);
    return { conversation_id: id, messages: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit } };
  }

  async history(id: string): Promise<ChatMessage[]> {
    const rows = await this.rows<ChatMessage>('messages.history',
      `SELECT id, conversation_id, role, content, created_at FROM public.messages
       WHERE conversation_id = $1 AND status = 'completed' AND role IN ('user', 'assistant')
       AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = $1 AND c.user_id = $2)
       ORDER BY created_at DESC, id DESC LIMIT 40`, [id, this.userId]);
    return rows.reverse();
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

}
