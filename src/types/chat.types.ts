export interface SendMessageInput {
  message: string;
  conversation_id?: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  user_id: string;
  title: string;
  model: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface StoredMessage extends ChatMessage {
  parent_message_id: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  updated_at: string;
}

export interface PaginationInput {
  limit: number;
  offset: number;
}

export type ChatEvent =
  | { event: 'conversation'; data: { conversation_id: string; created: boolean; user_message_id: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { conversation_id: string; message: ChatMessage } };
