import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { pool } from '../config/database';
import { HttpError } from './error.middleware';
import { verifyAccessToken } from '../services/token.service';
import { findUserById } from '../repositories/auth.repository';
export interface AuthContext { userId: string; db: Pool }
export const requireAuth: RequestHandler = async (req, res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Thiếu Bearer access token.', 'unauthorized');
  const { userId, version } = verifyAccessToken(match[1]);
  const user = await findUserById(userId);
  if (!user || user.deleted_at || !user.email_verified || user.token_version !== version
    || (user.banned_until && new Date(user.banned_until).getTime() > Date.now())) throw new HttpError(401, 'Phiên đăng nhập không còn hợp lệ.', 'unauthorized');
  res.locals.auth = { userId, db: pool } satisfies AuthContext;
  next();
};
