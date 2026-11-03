import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFound } from './middlewares/error.middleware';
import { authRouter } from './routes/auth.routes';
import { conversationRouter } from './routes/conversation.routes';
import { messageRouter, legacyMessageRouter } from './routes/message.routes';
import { chatRouter, legacyChatRouter } from './routes/chat.routes';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './config/openapi';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '64kb' }));
app.get('/api-docs.json', (_req, res) => res.json(openapiDocument));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, {
  customSiteTitle: 'AI Chat API Docs',
  swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
}));
app.use('/api/auth', authRouter);
app.use('/api/conversations', conversationRouter);
app.use('/api/messages', messageRouter);
app.use('/api/chat', chatRouter);
app.use('/api/conversations', legacyChatRouter);
app.use('/api/conversations/:conversation_id/messages', legacyMessageRouter);
app.use(notFound);
app.use(errorHandler);
