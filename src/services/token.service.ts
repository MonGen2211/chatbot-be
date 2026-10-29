import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { HttpError } from '../middlewares/error.middleware';
const issuer = 'ai-chat-be';
const audience = 'ai-chat-ui';
export function createSession(user: { id: string; token_version: number }) {
  const accessToken = jwt.sign({ ver: user.token_version }, env.jwtSecret, {
    algorithm: 'HS256', subject: user.id, issuer, audience, expiresIn: env.jwtExpiresInSeconds,
  });
  return {
    access_token: accessToken, token_type: 'bearer', expires_in: env.jwtExpiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + env.jwtExpiresInSeconds,
  };
}
export function verifyAccessToken(token: string): { userId: string; version: number } {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], issuer, audience });
    if (typeof payload === 'string' || typeof payload.sub !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)
      || !Number.isInteger(payload.ver) || typeof payload.exp !== 'number') throw new Error('Invalid token claims');
    return { userId: payload.sub, version: payload.ver };
  } catch {
    throw new HttpError(401, 'Access token không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.', 'unauthorized');
  }
}
