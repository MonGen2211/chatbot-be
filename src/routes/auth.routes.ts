import { Router } from 'express';
import { loginController, registerController } from '../controllers/auth.controller';
import { authRateLimit } from '../middlewares/auth-rate-limit.middleware';

export const authRouter = Router();
authRouter.post('/login', authRateLimit, loginController);
authRouter.post('/register', authRateLimit, registerController);
