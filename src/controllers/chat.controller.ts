import type { RequestHandler, Response } from 'express';
import { HttpError } from '../middlewares/error.middleware';
import type { AuthContext } from '../middlewares/auth.middleware';
import { sendMessage } from '../services/chat.service';
import { validateSendMessage } from '../validators/chat.validator';

async function writeEvent(res: Response, event: string, data: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  if (res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('drain', drained); signal.removeEventListener('abort', aborted); };
    const drained = () => { cleanup(); resolve(); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    res.once('drain', drained);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export const sendMessageController: RequestHandler = async (req, res) => {
  const input = validateSendMessage(req.body);
  const abort = new AbortController();
  const closed = () => { if (!res.writableFinished) abort.abort(); };
  res.once('close', closed);
  const timer = setTimeout(() => abort.abort(new Error('generation_timeout')), 120000);
  timer.unref();
  try {
    for await (const item of sendMessage(input, res.locals.auth as AuthContext, abort.signal)) {
      if (!res.headersSent) {
        res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
      }
      await writeEvent(res, item.event, item.data, abort.signal);
    }
    res.end();
  } catch (error) {
    if (res.destroyed) return;
    const failure = abort.signal.aborted
      ? new HttpError(504, 'Hết thời gian chờ Gemini.', 'generation_timeout')
      : error instanceof HttpError ? error : new HttpError(502, 'Không thể nhận câu trả lời Gemini.', 'generation_failed');
    if (!res.headersSent) throw failure;
    // Once SSE starts, HTTP status is already 200; report errors as SSE events.
    res.end(`event: error\ndata: ${JSON.stringify({ success: false, code: failure.code, message: failure.message })}\n\n`);
  } finally {
    clearTimeout(timer);
    res.off('close', closed);
    abort.abort();
  }
};
