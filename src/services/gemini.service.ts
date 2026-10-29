import { env } from '../config/env';
import { CHAT_DEVELOPER_PROMPT } from '../config/chat-prompt';
import { HttpError } from '../middlewares/error.middleware';
import type { ChatMessage } from '../types/chat.types';

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
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    if (response.status === 429) throw new HttpError(429, 'Gemini đã hết quota hoặc đang giới hạn yêu cầu.', 'gemini_rate_limited');
    throw new HttpError(502, 'Gemini từ chối yêu cầu. Kiểm tra API key, model và quyền truy cập.', 'gemini_upstream_error');
  }

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
