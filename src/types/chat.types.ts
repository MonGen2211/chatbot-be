import type { OperationMessage } from './message.types';

export interface SendMessageInput {
  message_id: string;
  message: string;
  conversation_id?: string;
}

export type ChatEvent =
  | { event: 'conversation'; data: { conversation_id: string; created: boolean; user_message_id: string; assistant_message: OperationMessage; user_message: OperationMessage; deleted_message_ids: string[]; replayed: boolean } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'reset'; data: { assistant_message_id: string; attempt: number } }
  | { event: 'superseded'; data: { assistant_message_id: string } }
  | { event: 'done'; data: { success: true; conversation_id: string; message: OperationMessage; user_message: OperationMessage; deleted_message_ids: string[]; replayed: boolean } };

