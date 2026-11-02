-- Stable ordering for edit/truncate, including existing rows with equal timestamps.
ALTER TABLE public.messages ADD COLUMN sequence_no bigint;
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS position FROM public.messages
)
UPDATE public.messages m SET sequence_no = o.position FROM ordered o WHERE m.id = o.id;
CREATE SEQUENCE public.messages_sequence_no_seq AS bigint;
SELECT setval('public.messages_sequence_no_seq', COALESCE((SELECT max(sequence_no) FROM public.messages), 0) + 1, false);
ALTER TABLE public.messages ALTER COLUMN sequence_no SET DEFAULT nextval('public.messages_sequence_no_seq');
ALTER TABLE public.messages ALTER COLUMN sequence_no SET NOT NULL;
ALTER SEQUENCE public.messages_sequence_no_seq OWNED BY public.messages.sequence_no;
CREATE UNIQUE INDEX messages_sequence_no_unique ON public.messages(sequence_no);
ALTER TABLE public.messages ADD COLUMN generation_id uuid;
ALTER TABLE public.messages ADD COLUMN is_edited boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN edited_at timestamptz;
CREATE INDEX messages_conversation_sequence_idx ON public.messages(conversation_id, sequence_no);
CREATE INDEX messages_pending_lease_idx ON public.messages(updated_at) WHERE role = 'assistant' AND status = 'pending';

-- Keep request tombstones even after edit deletes an old assistant, so replaying
-- an old client ID never creates records or calls the AI a second time.
CREATE TABLE app_private.chat_requests (
  user_id uuid NOT NULL REFERENCES app_private.users(id) ON DELETE CASCADE,
  client_message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  assistant_message_id uuid NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, client_message_id)
);
REVOKE ALL ON app_private.chat_requests FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON app_private.chat_requests FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
