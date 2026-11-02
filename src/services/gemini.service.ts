import { env } from '../config/env';
import { CHAT_DEVELOPER_PROMPT } from '../config/chat-prompt';
import { HttpError } from '../middlewares/error.middleware';
import type { ChatMessage } from '../types/message.types';
import { AiError, retryStream, type RetryOptions } from './ai-retry.service';

export interface GeminiChunk {
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

export function streamGemini(history: ChatMessage[], message: string, signal: AbortSignal, model = env.geminiModel, options: RetryOptions = {}) {
  return retryStream(attemptSignal => streamAttempt(history, message, attemptSignal, model), signal, options);
}

async function* streamAttempt(history: ChatMessage[], message: string, signal: AbortSignal, model: string): AsyncGenerator<GeminiChunk> {
  assertGeminiConfigured();
  const contents = [...history.map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
    { role: 'user', parts: [{ text: message }] }];
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiApiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CHAT_DEVELOPER_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    }),
    signal,
  });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new AiError('ai_network_error');
  }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    await response.body?.cancel().catch(() => undefined);
    console.warn('Gemini request failed:', { httpStatus: response.status });
    throw new AiError('ai_provider_error', response.status, retryAfter);
  }
  if (!response.body) throw new AiError('ai_invalid_stream');
  let finished = false;
  let hasText = false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  function parse(frame: string): GeminiChunk | undefined {
    const text = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!text || text === '[DONE]') return;
    try {
      const chunk = JSON.parse(text) as GeminiChunk;
      if (chunk.error) throw new AiError('ai_provider_error', (chunk.error as { code?: number }).code);
      const candidate = chunk.candidates?.[0];
      if (chunk.promptFeedback?.blockReason) throw new AiError('ai_blocked');
      if (candidate?.finishReason) {
        if (candidate.finishReason !== 'STOP') throw new AiError('ai_incomplete');
        finished = true;
      }
      if (candidate?.content?.parts?.some(part => !part.thought && part.text?.trim())) hasText = true;
      return chunk;
    }
    catch (error) { if (error instanceof AiError) throw error; throw new AiError('ai_invalid_stream'); }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Normalize after combining buffers so CRLF split across chunks is handled.
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 1024 * 1024) throw new AiError('ai_invalid_stream');
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
    if (!finished) throw new AiError('ai_network_error');
    if (!hasText) throw new AiError('ai_empty_response');
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof AiError) throw error;
    throw new AiError('ai_network_error');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
