import type { Pool } from 'pg';
import { HttpError } from '../middlewares/error.middleware';
import type { ConversationSummary } from '../types/conversation.types';
import type { PaginationInput } from '../types/pagination.types';
import { query, transaction } from '../config/database';

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

  async findOwned(id: string) {
    const rows = await this.rows<{ id: string }>('conversations.findOwned',
      'SELECT id FROM public.conversations WHERE id = $1 AND user_id = $2', [id, this.userId]);
    if (!rows[0]) throw new HttpError(404, 'Conversation không tồn tại hoặc bạn không có quyền truy cập.', 'conversation_not_found');
    return rows[0].id;
  }

  async rename(id: string, title: string) {
    const rows = await this.rows<ConversationSummary>('conversations.rename',
      `UPDATE public.conversations SET title = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, title, model, created_at, updated_at, last_message_at`, [id, this.userId, title]);
    if (!rows[0]) throw new HttpError(404, 'Conversation không tồn tại hoặc bạn không có quyền truy cập.', 'conversation_not_found');
    return { conversation: rows[0] };
  }

  async delete(id: string) {
    return transaction(this.db, 'conversations.delete', async client => {
      const owned = await client.query('SELECT id FROM public.conversations WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, this.userId]);
      if (!owned.rows[0]) throw new HttpError(404, 'Conversation không tồn tại hoặc bạn không có quyền truy cập.', 'conversation_not_found');
      // Explicitly remove messages so this also works with pre-existing FKs
      // that were not created with ON DELETE CASCADE.
      const deleted = await client.query<{ id: string }>('DELETE FROM public.messages WHERE conversation_id = $1 RETURNING id', [id]);
      await client.query('DELETE FROM public.conversations WHERE id = $1 AND user_id = $2', [id, this.userId]);
      // Keep idempotency tombstones: an old request must not recreate this chat.
      return { conversation_id: id, deleted_message_ids: deleted.rows.map(row => row.id) };
    }, this.signal);
  }

  async create(title: string, model: string) {
    const rows = await this.rows<{ id: string }>('conversations.create',
      'INSERT INTO public.conversations (user_id, title, model) VALUES ($1, $2, $3) RETURNING id', [this.userId, title, model]);
    return rows[0].id;
  }

  async touch(id: string) {
    await this.rows('conversations.touch',
      'UPDATE public.conversations SET updated_at = now(), last_message_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [id, this.userId]);
  }
}
