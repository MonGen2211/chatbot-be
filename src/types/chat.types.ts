import type { ChatMessage } from './message.types';

export interface SendMessageInput {
  message: string;
  conversation_id?: string;
}

export type ChatEvent =
  | { event: 'conversation'; data: { conversation_id: string; created: boolean; user_message_id: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { conversation_id: string; message: ChatMessage } };

