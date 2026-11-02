import type { Tables, TablesInsert } from './database.types';

export type ChatMessage = Pick<Tables<'messages'>,
  'id' | 'conversation_id' | 'role' | 'content' | 'created_at'>;

export type StoredMessage = Pick<Tables<'messages'>,
  keyof ChatMessage | 'parent_message_id' | 'status' | 'provider' | 'model' | 'updated_at' | 'is_edited' | 'edited_at'>;

export type OperationMessage = ChatMessage & {
  parent_message_id: string | null;
  status: 'pending' | 'completed' | 'failed';
  sequence_no: string;
  is_edited: boolean;
  edited_at: string | null;
  model: string | null;
  updated_at: string;
};

// Only provider metadata is accepted here; ownership and content are set by BE.
export type MessageMetadata = Pick<TablesInsert<'messages'>,
  'parent_message_id' | 'provider' | 'model' | 'response_id' | 'input_tokens' | 'output_tokens'>;
