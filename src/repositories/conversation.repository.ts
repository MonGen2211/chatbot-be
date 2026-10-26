import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../middlewares/error.middleware';
import type { ChatMessage, ConversationSummary, PaginationInput, StoredMessage } from '../types/chat.types';
import { databaseError } from './database-error';

export class ConversationRepository {
  constructor(private readonly db: SupabaseClient, private readonly userId: string, private readonly signal: AbortSignal) {}

  async listOwned({ limit, offset }: PaginationInput) {
    const { data, error } = await this.db.from('conversations')
      .select('id,user_id,title,model,created_at,updated_at,last_message_at')
      .eq('user_id', this.userId)
      .order('updated_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + limit).abortSignal(this.signal);
    if (error) throw databaseError('conversations.listOwned', error);
    const rows = (data ?? []) as ConversationSummary[];
    return { conversations: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit } };
  }

  async listMessages(id: string, { limit, offset }: PaginationInput) {
    // This client may use the server key, so verify ownership before querying messages.
    await this.findOwned(id);
    const { data, error } = await this.db.from('messages')
      .select('id,conversation_id,parent_message_id,role,content,status,provider,model,created_at,updated_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + limit).abortSignal(this.signal);
    if (error) throw databaseError('messages.list', error);
    const rows = (data ?? []) as StoredMessage[];
    return { conversation_id: id, messages: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit } };
  }

  async findOwned(id: string) {
    const { data, error } = await this.db.from('conversations').select('id').eq('id', id).eq('user_id', this.userId).abortSignal(this.signal).maybeSingle();
    if (error) throw databaseError('conversations.findOwned', error);
    if (!data) throw new HttpError(404, 'Conversation không tồn tại hoặc bạn không có quyền truy cập.', 'conversation_not_found');
    return data.id as string;
  }

  async create(title: string, model: string) {
    const { data, error } = await this.db.from('conversations').insert({ user_id: this.userId, title, model }).select('id').abortSignal(this.signal).single();
    if (error || !data) throw databaseError('conversations.create', error);
    return data.id as string;
  }

  async history(id: string): Promise<ChatMessage[]> {
    const { data, error } = await this.db.from('messages').select('id,conversation_id,role,content,created_at')
      .eq('conversation_id', id).eq('status', 'completed').in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(40).abortSignal(this.signal);
    if (error) throw databaseError('messages.history', error);
    // Keep recent context bounded rather than allowing unbounded provider requests.
    const messages = (data as ChatMessage[]).reverse();
    let characters = 0;
    let start = messages.length;
    while (start > 0 && characters + messages[start - 1].content.length <= 48000) {
      characters += messages[--start].content.length;
    }
    return messages.slice(start);
  }

  async addMessage(id: string, role: 'user' | 'assistant', content: string, details: Record<string, unknown> = {}): Promise<ChatMessage> {
    const { data, error } = await this.db.from('messages').insert({
      ...details, conversation_id: id, role, content, status: 'completed',
    }).select('id,conversation_id,role,content,created_at').abortSignal(this.signal).single();
    if (error || !data) throw databaseError('messages.insert', error);
    return data as ChatMessage;
  }

  async touch(id: string) {
    const now = new Date().toISOString();
    const { error } = await this.db.from('conversations').update({ updated_at: now, last_message_at: now })
      .eq('id', id).eq('user_id', this.userId).abortSignal(this.signal);
    if (error) throw databaseError('conversations.touch', error);
  }
}
