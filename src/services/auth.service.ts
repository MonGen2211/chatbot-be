import { HttpError } from '../middlewares/error.middleware';
import { signInWithPassword } from '../repositories/auth.repository';
import type { LoginInput } from '../types/auth.types';
import { env } from '../config/env';

export async function login(input: LoginInput) {
  const { data, error } = await signInWithPassword(input);
  if (error) {
    if (env.nodeEnv !== 'production') {
      // Only log diagnostic metadata; never log credentials or raw responses.
      console.warn('Supabase login failed:', { status: error.status, code: error.code, name: error.name });
    }
    if (error.code === 'invalid_credentials') {
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng.', 'invalid_credentials');
    }
    if (error.code === 'email_not_confirmed') {
      throw new HttpError(403, 'Bạn cần xác nhận email trước khi đăng nhập.', 'email_not_confirmed');
    }
    if (error.code === 'user_banned') {
      throw new HttpError(403, 'Tài khoản đã bị khóa.', 'user_banned');
    }
    if (error.status === 429) {
      throw new HttpError(429, 'Bạn thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.', 'auth_rate_limited');
    }
    if (!error.status || error.status >= 500 || error.status === 401 || error.status === 403) {
      throw new HttpError(503, 'Dịch vụ đăng nhập chưa sẵn sàng. Kiểm tra cấu hình Supabase.', 'auth_unavailable');
    }
    throw new HttpError(502, 'Supabase trả về lỗi không mong đợi. Kiểm tra URL/key và cấu hình Authentication.', 'auth_upstream_error');
  }
  if (!data.user || !data.session) {
    throw new HttpError(503, 'Supabase chưa trả về phiên đăng nhập hợp lệ.');
  }

  return {
    user: { id: data.user.id, email: data.user.email },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
    },
  };
}
