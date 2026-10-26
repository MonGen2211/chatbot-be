import { HttpError } from '../middlewares/error.middleware';
import { signInWithPassword, signUpWithPassword } from '../repositories/auth.repository';
import type { LoginInput, RegisterInput } from '../types/auth.types';
import { env } from '../config/env';

export async function register(input: RegisterInput) {
  const { data, error } = await signUpWithPassword(input);
  if (error) {
    if (env.nodeEnv !== 'production') {
      console.warn('Supabase registration failed:', { status: error.status, code: error.code, name: error.name });
    }
    if (error.status === 429) {
      throw new HttpError(429, 'Đã vượt giới hạn đăng ký hoặc gửi email. Vui lòng thử lại sau.', 'auth_rate_limited');
    }
    if (error.code === 'user_already_exists' || error.code === 'email_exists') {
      throw new HttpError(409, 'Email đã được đăng ký.', 'email_exists');
    }
    if (error.code === 'signup_disabled' || error.code === 'email_provider_disabled') {
      throw new HttpError(403, 'Đăng ký bằng email đang bị tắt trong cấu hình Supabase.', 'signup_disabled');
    }
    if (error.code === 'weak_password') {
      throw new HttpError(400, 'Mật khẩu chưa đáp ứng chính sách bảo mật của Supabase.', 'weak_password');
    }
    if (error.code === 'email_address_invalid' || error.code === 'validation_failed' || error.code === 'email_address_not_authorized') {
      throw new HttpError(400, 'Email không hợp lệ hoặc chưa được phép nhận email từ cấu hình gửi mail của Supabase.', 'invalid_signup_email');
    }
    if (error.code === 'captcha_failed') {
      throw new HttpError(400, 'Supabase yêu cầu CAPTCHA. Route hiện chưa hỗ trợ CAPTCHA.', 'captcha_failed');
    }
    if (!error.status || error.status >= 500 || error.status === 401 || error.status === 403) {
      throw new HttpError(503, 'Dịch vụ đăng ký chưa sẵn sàng. Kiểm tra cấu hình Supabase.', 'auth_unavailable');
    }
    throw new HttpError(502, 'Supabase trả về lỗi đăng ký không mong đợi.', 'auth_upstream_error');
  }
  if (!data.user) {
    throw new HttpError(502, 'Supabase chưa trả về kết quả đăng ký hợp lệ.', 'auth_upstream_error');
  }

  // With confirmation enabled, Supabase may obfuscate an existing account.
  // Accept the request without claiming that a new user was created.
  if (!data.session) {
    return { user: null, session: null, email_confirmation_required: true };
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
    email_confirmation_required: false,
  };
}

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
