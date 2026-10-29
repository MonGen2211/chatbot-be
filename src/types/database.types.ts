// Public schema snapshot originally generated from REST metadata.
// Run npm run db:types to refresh this file directly from PostgreSQL after migration.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      "conversations": {
        Row: {
          "created_at": string;
          "id": string;
          "last_message_at": string | null;
          "model": string | null;
          "title": string;
          "updated_at": string;
          "user_id": string;
        };
        Insert: {
          "created_at"?: string;
          "id"?: string;
          "last_message_at"?: string | null;
          "model"?: string | null;
          "title"?: string;
          "updated_at"?: string;
          "user_id": string;
        };
        Update: {
          "created_at"?: string;
          "id"?: string;
          "last_message_at"?: string | null;
          "model"?: string | null;
          "title"?: string;
          "updated_at"?: string;
          "user_id"?: string;
        };
        Relationships: [];
      };
      "messages": {
        Row: {
          "content": string;
          "conversation_id": string;
          "created_at": string;
          "error_text": string | null;
          "id": string;
          "input_tokens": number | null;
          "model": string | null;
          "output_tokens": number | null;
          "parent_message_id": string | null;
          "provider": string | null;
          "response_id": string | null;
          "role": string;
          "status": string;
          "updated_at": string;
        };
        Insert: {
          "content"?: string;
          "conversation_id": string;
          "created_at"?: string;
          "error_text"?: string | null;
          "id"?: string;
          "input_tokens"?: number | null;
          "model"?: string | null;
          "output_tokens"?: number | null;
          "parent_message_id"?: string | null;
          "provider"?: string | null;
          "response_id"?: string | null;
          "role": string;
          "status"?: string;
          "updated_at"?: string;
        };
        Update: {
          "content"?: string;
          "conversation_id"?: string;
          "created_at"?: string;
          "error_text"?: string | null;
          "id"?: string;
          "input_tokens"?: number | null;
          "model"?: string | null;
          "output_tokens"?: number | null;
          "parent_message_id"?: string | null;
          "provider"?: string | null;
          "response_id"?: string | null;
          "role"?: string;
          "status"?: string;
          "updated_at"?: string;
        };
        Relationships: [];
      };
      "profiles": {
        Row: {
          "avatar_url": string | null;
          "created_at": string;
          "display_name": string | null;
          "id": string;
          "updated_at": string;
        };
        Insert: {
          "avatar_url"?: string | null;
          "created_at"?: string;
          "display_name"?: string | null;
          "id": string;
          "updated_at"?: string;
        };
        Update: {
          "avatar_url"?: string | null;
          "created_at"?: string;
          "display_name"?: string | null;
          "id"?: string;
          "updated_at"?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
