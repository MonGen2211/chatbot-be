import { env } from '../config/env';
import { CHAT_DEVELOPER_PROMPT } from '../config/chat-prompt';
import { HttpError } from '../middlewares/error.middleware';
import type { ChatMessage } from '../types/message.types';

interface GeminiChunk {
  error?: unknown;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  responseId?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function assertGeminiConfigured() {
  if (!env.geminiApiKey) throw new HttpError(503, 'Chưa cấu hình GEMINI_API_KEY trong backend .env.', 'gemini_not_configured');
  if (!/^[a-zA-Z0-9._-]+$/.test(env.geminiModel)) throw new HttpError(503, 'GEMINI_MODEL không hợp lệ.', 'gemini_not_configured');
}

export async function* streamGemini(history: ChatMessage[], message: string, signal: AbortSignal): AsyncGenerator<GeminiChunk> {
  assertGeminiConfigured();
  const contents = [...history.map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
    { role: 'user', parts: [{ text: message }] }];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiApiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CHAT_DEVELOPER_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    }),
    signal,
  });
  if (!response.ok) {
    // Only retain provider metadata; raw bodies may contain prompt/key details.
    const failure = await response.json().catch(() => null) as {
      error?: { status?: string; details?: Array<{ reason?: string }> };
    } | null;
    const providerStatus = failure?.error?.status;
    const safeStatus = typeof providerStatus === 'string' && /^[A-Z_]{1,50}$/.test(providerStatus) ? providerStatus : undefined;
    console.warn('Gemini request failed:', { httpStatus: response.status, providerStatus: safeStatus });
    if (response.status === 429) throw new HttpError(429, 'Gemini đã hết quota hoặc đang giới hạn yêu cầu.', 'gemini_rate_limited');
    if (response.status === 503) throw new HttpError(503, 'Gemini đang quá tải hoặc tạm thời không khả dụng. Vui lòng thử lại sau.', 'gemini_unavailable');
    if (response.status === 500 || response.status === 504) throw new HttpError(503, 'Dịch vụ Gemini gặp lỗi tạm thời. Vui lòng thử lại sau.', 'gemini_unavailable');
    if (response.status === 401 || response.status === 403) throw new HttpError(502, 'Google từ chối API key hoặc quyền truy cập Gemini. Kiểm tra key trong backend.', 'gemini_permission_denied');
    if (response.status === 404) throw new HttpError(502, 'Không tìm thấy model Gemini hoặc key không có quyền dùng model này. Kiểm tra GEMINI_MODEL.', 'gemini_model_not_found');
    if (response.status === 400) throw new HttpError(502, 'Gemini không chấp nhận cấu hình request hoặc điều kiện sử dụng của project. Kiểm tra mã lỗi provider trong terminal backend.', 'gemini_invalid_request');
    throw new HttpError(502, 'Gemini trả về lỗi không mong đợi. Kiểm tra mã HTTP trong terminal backend.', 'gemini_upstream_error');
  }
  if (!response.body) throw new HttpError(502, 'Gemini không trả về response stream.', 'gemini_invalid_stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  function parse(frame: string): GeminiChunk | undefined {
    const text = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!text || text === '[DONE]') return;
    try { return JSON.parse(text) as GeminiChunk; }
    catch { throw new HttpError(502, 'Stream Gemini không hợp lệ.', 'gemini_invalid_stream'); }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize after combining buffers so CRLF split across chunks is handled.
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 1024 * 1024) throw new HttpError(502, 'Chunk Gemini quá lớn.', 'gemini_invalid_stream');
      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const chunk = parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (chunk) yield chunk;
      }
      if (done) {
        if (buffer.trim()) { const chunk = parse(buffer); if (chunk) yield chunk; }
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
