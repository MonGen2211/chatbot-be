import { Router } from 'express';
import { loginController, registerController } from '../controllers/auth.controller';

export const authRouter = Router();
authRouter.post('/login', loginController);
authRouter.post('/register', registerController);
