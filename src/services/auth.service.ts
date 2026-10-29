import { compare, hash } from 'bcryptjs';
import { HttpError } from '../middlewares/error.middleware';
import { createUser, findUserByEmail } from '../repositories/auth.repository';
import type { LoginInput, RegisterInput } from '../types/auth.types';
import { createSession } from './token.service';
const dummyHash = hash('dummy-password-for-timing-only', 12);
export async function register(input: RegisterInput) {
  const passwordHash = await hash(input.password, 12);
  const user = await createUser(input.email, passwordHash);
  return { user: { id: user.id, email: user.email }, session: createSession(user), email_confirmation_required: false };
}
export async function login(input: LoginInput) {
  const user = await findUserByEmail(input.email);
  const valid = await compare(input.password, user?.password_hash || await dummyHash);
  if (!user || !user.password_hash || !valid || user.deleted_at) throw new HttpError(401, 'Email hoặc mật khẩu không đúng.', 'invalid_credentials');
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) throw new HttpError(403, 'Tài khoản đã bị khóa.', 'user_banned');
  if (!user.email_verified) throw new HttpError(403, 'Tài khoản cũ chưa được xác nhận email trước khi chuyển đổi. Liên hệ người quản lý ứng dụng.', 'email_not_confirmed');
  return { user: { id: user.id, email: user.email }, session: createSession(user) };
}
