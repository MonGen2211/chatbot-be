import { rateLimit } from 'express-rate-limit';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, code: 'auth_rate_limited', message: 'Bạn đã gửi quá nhiều yêu cầu đăng nhập/đăng ký. Vui lòng thử lại sau.' },
});
