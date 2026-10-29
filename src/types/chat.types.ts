export interface SendMessageInput {
  message: string;
  conversation_id?: string;
}

export type ChatMessage = Pick<Tables<'messages'>,
  'id' | 'conversation_id' | 'role' | 'content' | 'created_at'>;

export type ConversationSummary = Tables<'conversations'>;

export type StoredMessage = Pick<Tables<'messages'>,
  keyof ChatMessage | 'parent_message_id' | 'status' | 'provider' | 'model' | 'updated_at'>;

// Only provider metadata is accepted here; ownership and content are set by BE.
export type MessageMetadata = Pick<TablesInsert<'messages'>,
  'parent_message_id' | 'provider' | 'model' | 'response_id' | 'input_tokens' | 'output_tokens'>;

export interface PaginationInput {
  limit: number;
  offset: number;
}

export type ChatEvent =
  | { event: 'conversation'; data: { conversation_id: string; created: boolean; user_message_id: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { conversation_id: string; message: ChatMessage } };
import type { Tables, TablesInsert } from './database.types';

