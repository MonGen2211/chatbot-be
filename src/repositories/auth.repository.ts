import { createSupabaseClient } from '../config/supabase';
import type { LoginInput, RegisterInput } from '../types/auth.types';

export function signInWithPassword(input: LoginInput) {
  return createSupabaseClient().auth.signInWithPassword(input);
}

export function signUpWithPassword(input: RegisterInput) {
  // Public signup respects Supabase's signup and email confirmation settings.
  // Do not use admin.createUser or auto-confirm the user's email here.
  return createSupabaseClient().auth.signUp(input);
}
