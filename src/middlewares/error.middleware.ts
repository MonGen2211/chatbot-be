import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, message: 'Route không tồn tại.' });
};
// ghi chú mới:
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
    return;
  }

  const parserError = error as { type?: string } | null;
  if (parserError?.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, message: 'JSON không hợp lệ.' });
    return;
  }
  if (parserError?.type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'Request body quá lớn.' });
    return;
  }

  // Do not log request bodies, passwords, tokens, or upstream response bodies.
  console.error('Unhandled API error:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ.' });
};
