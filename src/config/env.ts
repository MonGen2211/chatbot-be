import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Configure ai-chat-be/.env using .env.example.`);
  return value;
}
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be from 1 to 65535.');
const databaseUrl = required('DATABASE_URL');
let databaseProtocol: string;
try { databaseProtocol = new URL(databaseUrl).protocol; }
catch { throw new Error('DATABASE_URL is not a valid PostgreSQL URI. Check URL-encoding of the password.'); }
if (!['postgres:', 'postgresql:'].includes(databaseProtocol)) throw new Error('DATABASE_URL must be a PostgreSQL URI.');
const jwtSecret = required('JWT_SECRET');
if (Buffer.byteLength(jwtSecret) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes.');
const duration = /^(\d+)(s|m|h|d)?$/.exec(process.env.JWT_EXPIRES_IN?.trim() || '1h');
if (!duration) throw new Error('JWT_EXPIRES_IN must be seconds or a duration such as 1h.');
const seconds = Number(duration[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[duration[2] || 's'] ?? 1);
if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 604800) throw new Error('JWT_EXPIRES_IN must be between 60 seconds and 7 days.');
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development', port,
  corsOrigin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173',
  databaseUrl, jwtSecret, jwtExpiresInSeconds: seconds,
  databaseCaFile: process.env.DATABASE_CA_FILE?.trim() || '',
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || '',
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
};
