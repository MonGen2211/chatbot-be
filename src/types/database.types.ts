// Generated from PostgreSQL public schema by npm run db:types. Do not edit manually.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = { public: { Tables: {
"conversations": {
Row: {
  "id": string;
  "user_id": string;
  "title": string;
  "model": string | null;
  "created_at": string;
  "updated_at": string;
  "last_message_at": string | null;
};
Insert: {
  "id"?: string;
  "user_id": string;
  "title"?: string;
  "model"?: string | null;
  "created_at"?: string;
  "updated_at"?: string;
  "last_message_at"?: string | null;
};
Update: {
  "id"?: string;
  "user_id"?: string;
  "title"?: string;
  "model"?: string | null;
  "created_at"?: string;
  "updated_at"?: string;
  "last_message_at"?: string | null;
};
Relationships: [];
};
"messages": {
Row: {
  "id": string;
  "conversation_id": string;
  "parent_message_id": string | null;
  "role": string;
  "content": string;
  "status": string;
  "provider": string | null;
  "model": string | null;
  "response_id": string | null;
  "input_tokens": number | null;
  "output_tokens": number | null;
  "error_text": string | null;
  "created_at": string;
  "updated_at": string;
  "sequence_no": string;
  "generation_id": string | null;
  "is_edited": boolean;
  "edited_at": string | null;
};
Insert: {
  "id"?: string;
  "conversation_id": string;
  "parent_message_id"?: string | null;
  "role": string;
  "content"?: string;
  "status"?: string;
  "provider"?: string | null;
  "model"?: string | null;
  "response_id"?: string | null;
  "input_tokens"?: number | null;
  "output_tokens"?: number | null;
  "error_text"?: string | null;
  "created_at"?: string;
  "updated_at"?: string;
  "sequence_no"?: string;
  "generation_id"?: string | null;
  "is_edited"?: boolean;
  "edited_at"?: string | null;
};
Update: {
  "id"?: string;
  "conversation_id"?: string;
  "parent_message_id"?: string | null;
  "role"?: string;
  "content"?: string;
  "status"?: string;
  "provider"?: string | null;
  "model"?: string | null;
  "response_id"?: string | null;
  "input_tokens"?: number | null;
  "output_tokens"?: number | null;
  "error_text"?: string | null;
  "created_at"?: string;
  "updated_at"?: string;
  "sequence_no"?: string;
  "generation_id"?: string | null;
  "is_edited"?: boolean;
  "edited_at"?: string | null;
};
Relationships: [];
};
"profiles": {
Row: {
  "id": string;
  "display_name": string | null;
  "avatar_url": string | null;
  "created_at": string;
  "updated_at": string;
};
Insert: {
  "id": string;
  "display_name"?: string | null;
  "avatar_url"?: string | null;
  "created_at"?: string;
  "updated_at"?: string;
};
Update: {
  "id"?: string;
  "display_name"?: string | null;
  "avatar_url"?: string | null;
  "created_at"?: string;
  "updated_at"?: string;
};
Relationships: [];
};
}; Views: { [_ in never]: never }; Functions: { [_ in never]: never }; Enums: { [_ in never]: never }; CompositeTypes: { [_ in never]: never }; }; };
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
