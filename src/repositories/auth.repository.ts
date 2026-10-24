import { createSupabaseClient } from '../config/supabase';
import type { LoginInput } from '../types/auth.types';

export function signInWithPassword(input: LoginInput) {
  return createSupabaseClient().auth.signInWithPassword(input);
}
