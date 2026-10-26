import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Each request gets its own client so login sessions never leak across users.
function createConfiguredClient(key: string, accessToken?: string) {
  return createClient(env.supabaseUrl, key, {
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createSupabaseClient(accessToken?: string) {
  return createConfiguredClient(env.supabaseKey, accessToken);
}

// Server database access is separate from the user's login verification.
// Ownership checks in the repository/service remain mandatory with a secret key.
export function createChatDatabaseClient(accessToken: string) {
  return env.supabaseServerKey
    ? createConfiguredClient(env.supabaseServerKey)
    : createSupabaseClient(accessToken);
}
