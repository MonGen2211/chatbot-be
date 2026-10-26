import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFound } from './middlewares/error.middleware';
import { authRouter } from './routes/auth.routes';
import { conversationRouter } from './routes/conversation.routes';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '64kb' }));
app.use('/api/auth', authRouter);
app.use('/api/conversations', conversationRouter);
app.use(notFound);
app.use(errorHandler);
