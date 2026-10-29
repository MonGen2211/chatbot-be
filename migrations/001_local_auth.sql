-- Run through npm run db:migrate; this file is wrapped in a transaction.
-- Preserve Supabase-managed auth data and existing user/conversation IDs.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  password_hash text,
  email_verified boolean NOT NULL DEFAULT true,
  banned_until timestamptz,
  deleted_at timestamptz,
  token_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON app_private.users (lower(email)) WHERE email IS NOT NULL;
REVOKE ALL ON app_private.users FROM PUBLIC;

-- Import existing accounts once. Passwordless/social users keep their ID but
-- cannot use password login until a password is set through a separate workflow.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $import$
      INSERT INTO app_private.users (id, email, password_hash, email_verified, banned_until, deleted_at, created_at, updated_at)
      SELECT id, NULLIF(lower(email), ''),
        CASE WHEN encrypted_password ~ '^\$2[aby]\$' THEN encrypted_password ELSE NULL END,
        email_confirmed_at IS NOT NULL, banned_until, deleted_at,
        COALESCE(created_at, now()), COALESCE(updated_at, now())
      FROM auth.users ON CONFLICT (id) DO NOTHING
    $import$;
  END IF;
END $$;

-- Existing chat tables are retained. Support an empty database as well.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND contype = 'f'
      AND confrelid = to_regclass('auth.users')
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', item.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_app_user_fkey') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_app_user_fkey
      FOREIGN KEY (id) REFERENCES app_private.users(id) ON DELETE CASCADE;
  END IF;
END $$;
INSERT INTO public.profiles (id) SELECT id FROM app_private.users ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Chat',
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  parent_message_id uuid REFERENCES public.messages(id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed',
  provider text, model text, response_id text,
  input_tokens integer, output_tokens integer, error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_owner_updated_idx ON public.conversations(user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON public.messages(conversation_id, created_at, id);

-- Do not expose password hashes via Supabase's public Data API.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app_private FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
