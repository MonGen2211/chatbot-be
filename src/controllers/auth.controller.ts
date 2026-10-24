import type { RequestHandler } from 'express';
import { login } from '../services/auth.service';
import { validateLogin } from '../validators/auth.validator';

export const loginController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const input = validateLogin(req.body);
  const data = await login(input);
  res.status(200).json({ success: true, message: 'Đăng nhập thành công.', data });
};
