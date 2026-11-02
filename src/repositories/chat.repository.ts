import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../middlewares/error.middleware';
import { databaseError } from './database-error';
import type { SendMessageInput } from '../types/chat.types';
import type { ChatMessage, OperationMessage } from '../types/message.types';

const columns = 'id, conversation_id, parent_message_id, role, content, status, sequence_no, is_edited, edited_at, model, created_at, updated_at';
export interface ChatJob {
  conversationId: string; created: boolean; replayed: boolean;
  user: OperationMessage; assistant: OperationMessage; history: ChatMessage[];
  generationId?: string; deletedIds: string[];
}
export interface ChatStore {
  prepareSend(input: SendMessageInput, model: string): Promise<ChatJob>;
  prepareRetry(id: string): Promise<ChatJob>;
  prepareEdit(id: string, content: string, model: string): Promise<ChatJob>;
  heartbeat(job: ChatJob): Promise<boolean>;
  finish(job: ChatJob, content: string, failed: boolean, metadata?: { responseId?: string; inputTokens?: number; outputTokens?: number }): Promise<OperationMessage | null>;
}
const missing = () => new HttpError(404, 'Không tìm thấy message/conversation của bạn.', 'message_not_found');

export class ChatRepository implements ChatStore {
  constructor(private readonly db: Pool, private readonly userId: string) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect().catch(error => { throw databaseError('chat.connect', error); });
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw databaseError('chat.transaction', error as { code?: string; message?: string });
    } finally { client.release(); }
  }
  private async lock(client: PoolClient, conversationId: string) {
    const result = await client.query('SELECT id FROM public.conversations WHERE id = $1 AND user_id = $2 FOR UPDATE', [conversationId, this.userId]);
    if (!result.rows[0]) throw missing();
  }
  private async expire(client: PoolClient, conversationId: string) {
    await client.query(`UPDATE public.messages SET status = 'failed', generation_id = NULL,
      error_text = 'Câu trả lời bị gián đoạn. Vui lòng thử lại.', updated_at = now()
      WHERE conversation_id = $1 AND role = 'assistant' AND status = 'pending'
      AND updated_at <= now() - interval '2 minutes'`, [conversationId]);
  }
  private async message(client: PoolClient, id: string): Promise<OperationMessage> {
    const result = await client.query<OperationMessage>(`SELECT ${columns} FROM public.messages WHERE id = $1`, [id]);
    if (!result.rows[0]) throw missing();
    return result.rows[0];
  }
  private async lockForMessage(client: PoolClient, id: string) {
    const result = await client.query<{ conversation_id: string }>(`SELECT m.conversation_id FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id WHERE m.id = $1 AND c.user_id = $2`, [id, this.userId]);
    if (!result.rows[0]) throw missing();
    await this.lock(client, result.rows[0].conversation_id);
    return result.rows[0].conversation_id;
  }
  private async history(client: PoolClient, user: OperationMessage): Promise<ChatMessage[]> {
    const result = await client.query<ChatMessage>(`SELECT id, conversation_id, role, content, created_at FROM public.messages
      WHERE conversation_id = $1 AND status = 'completed' AND sequence_no < $2::bigint
      AND role IN ('user','assistant') ORDER BY sequence_no DESC LIMIT 40`, [user.conversation_id, user.sequence_no]);
    return result.rows.reverse();
  }
  private async touch(client: PoolClient, id: string) {
    await client.query('UPDATE public.conversations SET updated_at = now(), last_message_at = now() WHERE id = $1 AND user_id = $2', [id, this.userId]);
  }
  private async assistant(client: PoolClient, user: OperationMessage, model: string) {
    const generationId = randomUUID();
    const result = await client.query<OperationMessage>(`INSERT INTO public.messages
      (id, conversation_id, parent_message_id, role, content, status, generation_id, provider, model)
      VALUES ($1,$2,$3,'assistant','','pending',$4,'google',$5) RETURNING ${columns}`,
    [randomUUID(), user.conversation_id, user.id, generationId, model]);
    return { assistant: result.rows[0], generationId };
  }
  async prepareSend(input: SendMessageInput, model: string): Promise<ChatJob> {
    // Commit stale recovery even when the subsequent new-send check returns 409.
    if (input.conversation_id) {
      await this.db.query(`UPDATE public.messages SET status = 'failed', generation_id = NULL,
        error_text = 'Câu trả lời bị gián đoạn. Vui lòng thử lại.', updated_at = now()
        WHERE conversation_id = $1 AND role = 'assistant' AND status = 'pending'
        AND updated_at <= now() - interval '2 minutes'
        AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = $1 AND c.user_id = $2)`,
      [input.conversation_id, this.userId]).catch(error => { throw databaseError('chat.expireStale', error); });
    }
    return this.transaction(async client => {
      // Serialize identical client IDs before a conversation even exists.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${this.userId}:${input.message_id}`]);
      const hash = createHash('sha256').update(input.message).digest('hex');
      const prior = (await client.query<{ conversation_id: string; assistant_message_id: string; content_hash: string }>(
        'SELECT conversation_id, assistant_message_id, content_hash FROM app_private.chat_requests WHERE user_id = $1 AND client_message_id = $2',
        [this.userId, input.message_id])).rows[0];
      if (prior) {
        if (prior.content_hash !== hash || (input.conversation_id && input.conversation_id !== prior.conversation_id)) {
          throw new HttpError(409, 'Message ID đã được dùng cho một yêu cầu khác.', 'idempotency_conflict');
        }
        await this.lock(client, prior.conversation_id);
        await this.expire(client, prior.conversation_id);
        const user = await this.message(client, input.message_id);
        const saved = await client.query<OperationMessage>(`SELECT ${columns} FROM public.messages WHERE id = $1`, [prior.assistant_message_id]);
        if (!saved.rows[0]) throw new HttpError(409, 'Yêu cầu này đã bị thay thế bởi thao tác chỉnh sửa.', 'operation_superseded');
        return { conversationId: prior.conversation_id, created: false, replayed: true, user, assistant: saved.rows[0], history: [], deletedIds: [] };
      }
      const collision = await client.query('SELECT id FROM public.messages WHERE id = $1', [input.message_id]);
      if (collision.rows[0]) throw missing();
      let conversationId = input.conversation_id;
      if (conversationId) await this.lock(client, conversationId);
      else {
        const created = await client.query<{ id: string }>('INSERT INTO public.conversations (user_id, title, model) VALUES ($1,$2,$3) RETURNING id',
          [this.userId, input.message.trim().slice(0, 80), model]);
        conversationId = created.rows[0].id;
      }
      await this.expire(client, conversationId);
      const blocked = await client.query(`SELECT id FROM public.messages WHERE conversation_id = $1
        AND role = 'assistant' AND status IN ('pending','failed') LIMIT 1`, [conversationId]);
      if (blocked.rows[0]) throw new HttpError(409, 'Hãy thử lại hoặc chỉnh sửa câu trả lời chưa hoàn tất trước khi gửi tin mới.', 'conversation_unresolved');
      const user = (await client.query<OperationMessage>(`INSERT INTO public.messages (id,conversation_id,role,content,status)
        VALUES ($1,$2,'user',$3,'completed') RETURNING ${columns}`, [input.message_id, conversationId, input.message])).rows[0];
      const pending = await this.assistant(client, user, model);
      await client.query(`INSERT INTO app_private.chat_requests
        (user_id,client_message_id,conversation_id,assistant_message_id,content_hash) VALUES ($1,$2,$3,$4,$5)`,
      [this.userId, input.message_id, conversationId, pending.assistant.id, hash]);
      await this.touch(client, conversationId);
      return { conversationId, created: !input.conversation_id, replayed: false, user, ...pending, history: await this.history(client, user), deletedIds: [] };
    });
  }
  async prepareRetry(id: string): Promise<ChatJob> {
    return this.transaction(async client => {
      const conversationId = await this.lockForMessage(client, id);
      await this.expire(client, conversationId);
      const old = await this.message(client, id);
      if (old.role !== 'assistant' || old.status !== 'failed' || !old.parent_message_id) {
        throw new HttpError(409, 'Chỉ được thử lại message assistant đang failed.', 'message_not_retryable');
      }
      const active = await client.query(`SELECT id FROM public.messages WHERE conversation_id = $1
        AND role = 'assistant' AND status = 'pending' AND id <> $2 LIMIT 1`, [conversationId, id]);
      if (active.rows[0]) throw new HttpError(409, 'Conversation đang có câu trả lời được tạo.', 'conversation_busy');
      const user = await this.message(client, old.parent_message_id);
      if (user.role !== 'user' || user.conversation_id !== conversationId) throw missing();
      const generationId = randomUUID();
      const assistant = (await client.query<OperationMessage>(`UPDATE public.messages SET status = 'pending', content = '',
        error_text = NULL, generation_id = $2, response_id = NULL, input_tokens = NULL, output_tokens = NULL, updated_at = now()
        WHERE id = $1 RETURNING ${columns}`, [id, generationId])).rows[0];
      await this.touch(client, conversationId);
      return { conversationId, created: false, replayed: false, user, assistant, generationId, history: await this.history(client, user), deletedIds: [] };
    });
  }
  async prepareEdit(id: string, content: string, model: string): Promise<ChatJob> {
    return this.transaction(async client => {
      const conversationId = await this.lockForMessage(client, id);
      const old = await this.message(client, id);
      if (old.role !== 'user') throw new HttpError(400, 'Chỉ được chỉnh sửa tin nhắn user.', 'invalid_message_role');
      const deleted = await client.query<{ id: string }>('DELETE FROM public.messages WHERE conversation_id = $1 AND sequence_no > $2::bigint RETURNING id', [conversationId, old.sequence_no]);
      const user = (await client.query<OperationMessage>(`UPDATE public.messages SET content = $2,
        is_edited = true, edited_at = now(), updated_at = now() WHERE id = $1 RETURNING ${columns}`, [id, content])).rows[0];
      const pending = await this.assistant(client, user, model);
      await this.touch(client, conversationId);
      return { conversationId, created: false, replayed: false, user, ...pending, history: await this.history(client, user), deletedIds: deleted.rows.map(row => row.id) };
    });
  }
  async heartbeat(job: ChatJob): Promise<boolean> {
    const result = await this.db.query(`UPDATE public.messages SET updated_at = now() WHERE id = $1 AND generation_id = $2
      AND status = 'pending' AND updated_at > now() - interval '2 minutes'
      AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = $3)`,
    [job.assistant.id, job.generationId, this.userId]);
    return result.rowCount === 1;
  }
  async finish(job: ChatJob, content: string, failed: boolean, metadata: { responseId?: string; inputTokens?: number; outputTokens?: number } = {}): Promise<OperationMessage | null> {
    return this.transaction(async client => {
      const owned = await client.query('SELECT id FROM public.conversations WHERE id = $1 AND user_id = $2 FOR UPDATE', [job.conversationId, this.userId]);
      if (!owned.rows[0]) return null;
      await this.expire(client, job.conversationId);
      const result = await client.query<OperationMessage>(`UPDATE public.messages SET status = $3, content = $4,
        error_text = $5, generation_id = NULL, response_id = $6, input_tokens = $7, output_tokens = $8, updated_at = now()
        WHERE id = $1 AND generation_id = $2 AND status = 'pending'
        AND parent_message_id = $9 AND EXISTS (SELECT 1 FROM public.messages p WHERE p.id = $9 AND p.role = 'user')
        RETURNING ${columns}`,
      [job.assistant.id, job.generationId, failed ? 'failed' : 'completed', failed ? '' : content,
        failed ? 'Không thể hoàn tất câu trả lời. Vui lòng thử lại.' : null,
        metadata.responseId ?? null, metadata.inputTokens ?? null, metadata.outputTokens ?? null, job.user.id]);
      if (!result.rows[0]) return null;
      await this.touch(client, job.conversationId);
      return result.rows[0];
    });
  }
}
