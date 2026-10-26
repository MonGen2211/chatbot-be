import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Configure ai-chat-be/.env using .env.example.`);
  return value;
}

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535.');
}

const parsedSupabaseUrl = new URL(required('SUPABASE_URL'));
if (!['http:', 'https:'].includes(parsedSupabaseUrl.protocol)) {
  throw new Error('SUPABASE_URL must be an HTTP(S) project URL.');
}
// Accept dashboard REST/Auth endpoint URLs and resolve them to the project root.
if (/^\/(rest|auth)\/v1\/?$/.test(parsedSupabaseUrl.pathname)) {
  parsedSupabaseUrl.pathname = '/';
}
if (parsedSupabaseUrl.pathname !== '/' || parsedSupabaseUrl.search || parsedSupabaseUrl.hash || parsedSupabaseUrl.username || parsedSupabaseUrl.password) {
  throw new Error('SUPABASE_URL must be the project base URL, e.g. https://project.supabase.co (without /rest/v1 or /auth/v1).');
}

// Public key is preferred for login; secret keys are supported on this server only.
// Keep accepting the original variable name for existing local configuration.
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim()
  || process.env.SUPABASE_SECRET_KEY?.trim()
  || required('SUPABASE_ANON_KEY');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  corsOrigin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173',
  supabaseUrl: parsedSupabaseUrl.toString().replace(/\/$/, ''),
  supabaseKey,
  supabaseServerKey: process.env.SUPABASE_SECRET_KEY?.trim() || '',
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || '',
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
};
