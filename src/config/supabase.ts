import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Create a client per login so different requests do not share a user session.
// Future database queries should use the caller's access token to respect RLS.
export function createSupabaseClient() {
  return createClient(env.supabaseUrl, env.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
