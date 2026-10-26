import { HttpError } from '../middlewares/error.middleware';
import type { LoginInput, RegisterInput } from '../types/auth.types';

export function validateLogin(body: unknown): LoginInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body phải là JSON gồm email và password.');
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
    throw new HttpError(400, 'Email không hợp lệ.');
  }
  if (typeof password !== 'string' || password.length === 0 || password.length > 4096) {
    throw new HttpError(400, 'Password phải là chuỗi từ 1 đến 4096 ký tự.');
  }
  return { email: email.trim(), password };
}

export function validateRegister(body: unknown): RegisterInput {
  const input = validateLogin(body);
  if (input.password.length < 8) {
    throw new HttpError(400, 'Mật khẩu đăng ký phải có ít nhất 8 ký tự.', 'weak_password');
  }
  return input;
}
