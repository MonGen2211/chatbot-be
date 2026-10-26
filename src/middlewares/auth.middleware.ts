import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient, createChatDatabaseClient } from '../config/supabase';
import { HttpError } from './error.middleware';

export interface AuthContext { userId: string; db: SupabaseClient }

export const requireAuth: RequestHandler = async (req, res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Thiếu Bearer access token.', 'unauthorized');
  const token = match[1];
  const verifier = createSupabaseClient(token);
  const { data, error } = await verifier.auth.getUser(token);
  if (error) {
    if (!error.status || error.status >= 500) {
      throw new HttpError(503, 'Không thể xác thực với Supabase.', 'auth_unavailable');
    }
    throw new HttpError(401, 'Access token không hợp lệ hoặc đã hết hạn.', 'unauthorized');
  }
  if (!data.user) throw new HttpError(401, 'Access token không hợp lệ.', 'unauthorized');
  res.locals.auth = { userId: data.user.id, db: createChatDatabaseClient(token) } satisfies AuthContext;
  next();
};
