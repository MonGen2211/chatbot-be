import { env } from '../config/env';
import { HttpError } from '../middlewares/error.middleware';
import type { AuthContext } from '../middlewares/auth.middleware';
import { ConversationRepository } from '../repositories/conversation.repository';
import { MessageRepository } from '../repositories/message.repository';
import type { ChatEvent, SendMessageInput } from '../types/chat.types';
import { assertGeminiConfigured, streamGemini } from './gemini.service';

// Prevent interleaved turns within this backend process.
const activeConversations = new Set<string>();

export async function* sendMessage(input: SendMessageInput, auth: AuthContext, signal: AbortSignal): AsyncGenerator<ChatEvent> {
  assertGeminiConfigured();
  const conversations = new ConversationRepository(auth.db, auth.userId, signal);
  const messages = new MessageRepository(auth.db, auth.userId, signal);
  const id = input.conversation_id
    ? await conversations.findOwned(input.conversation_id)
    : await conversations.create(input.message.trim().slice(0, 80), env.geminiModel);
  if (activeConversations.has(id)) throw new HttpError(409, 'Conversation đang có câu trả lời được tạo. Vui lòng đợi.', 'conversation_busy');
  activeConversations.add(id);
  try {
    signal.throwIfAborted();
    const recent = await messages.history(id);
    // Context limits belong to AI orchestration, not message storage.
    let characters = 0;
    let start = recent.length;
    while (start > 0 && characters + recent[start - 1].content.length <= 48000) {
      characters += recent[--start].content.length;
    }
    const history = recent.slice(start);
    const userMessage = await messages.addMessage(id, 'user', input.message);
    await conversations.touch(id);
    yield { event: 'conversation', data: { conversation_id: id, created: !input.conversation_id, user_message_id: userMessage.id } };
    let answer = '';
    let responseId: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let finishReason: string | undefined;
    for await (const chunk of streamGemini(history, input.message, signal)) {
      signal.throwIfAborted();
      if (chunk.error) throw new HttpError(502, 'Gemini báo lỗi giữa stream.', 'gemini_upstream_error');
      if (chunk.promptFeedback?.blockReason) throw new HttpError(422, 'Gemini không thể xử lý nội dung này.', 'gemini_blocked');
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (finishReason === 'MAX_TOKENS') throw new HttpError(502, 'Gemini đã chạm giới hạn token trước khi hoàn tất câu trả lời.', 'gemini_truncated');
      if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) {
        throw new HttpError(422, 'Gemini đã dừng câu trả lời do giới hạn nội dung.', 'gemini_blocked');
      }
      const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
      responseId = chunk.responseId ?? responseId;
      inputTokens = chunk.usageMetadata?.promptTokenCount ?? inputTokens;
      outputTokens = chunk.usageMetadata?.candidatesTokenCount ?? outputTokens;
      if (text) {
        answer += text;
        if (answer.length > 100000) throw new HttpError(502, 'Câu trả lời vượt giới hạn.', 'gemini_output_too_large');
        yield { event: 'delta', data: { text } };
      }
    }
    signal.throwIfAborted();
    if (!answer.trim() || !finishReason) throw new HttpError(502, 'Gemini trả về rỗng hoặc stream bị ngắt trước khi hoàn tất.', 'gemini_incomplete');
    const assistant = await messages.addMessage(id, 'assistant', answer, {
      parent_message_id: userMessage.id, provider: 'google', model: env.geminiModel,
      ...(responseId ? { response_id: responseId } : {}),
      ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    });
    await conversations.touch(id);
    yield { event: 'done', data: { conversation_id: id, message: assistant } };
  } finally {
    activeConversations.delete(id);
  }
}
