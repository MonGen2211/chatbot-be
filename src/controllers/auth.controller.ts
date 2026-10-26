import type { RequestHandler } from 'express';
import { login, register } from '../services/auth.service';
import { validateLogin, validateRegister } from '../validators/auth.validator';

export const loginController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const input = validateLogin(req.body);
  const data = await login(input);
  res.status(200).json({ success: true, message: 'Đăng nhập thành công.', data });
};

export const registerController: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const input = validateRegister(req.body);
  const data = await register(input);
  res.status(data.session ? 201 : 202).json({
    success: true,
    message: data.session
      ? 'Đăng ký thành công.'
      : 'Đã tiếp nhận yêu cầu đăng ký. Vui lòng kiểm tra email xác nhận; nếu đã có tài khoản, hãy đăng nhập.',
    data,
  });
};
