import { env } from '../config/env';
import type { AuthContext } from '../middlewares/auth.middleware';
import { ChatRepository, type ChatJob, type ChatStore } from '../repositories/chat.repository';
import type { ChatEvent, SendMessageInput } from '../types/chat.types';
import { streamGemini } from './gemini.service';
import { AiError } from './ai-retry.service';

export class ChatService {
  constructor(private readonly store: ChatStore, private readonly provider = streamGemini) {}
  async *send(input: SendMessageInput, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    yield* this.execute(await this.store.prepareSend(input, env.geminiModel), signal);
  }
  async *retry(id: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    yield* this.execute(await this.store.prepareRetry(id), signal);
  }
  async *edit(id: string, content: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    yield* this.execute(await this.store.prepareEdit(id, content, env.geminiModel), signal);
  }
  private async *execute(job: ChatJob, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    let settled = !job.generationId;
    const superseded = new AbortController();
    const providerSignal = AbortSignal.any([signal, superseded.signal]);
    let heartbeat: Promise<void> | undefined;
    const lease = job.generationId ? setInterval(() => {
      if (!heartbeat) heartbeat = this.store.heartbeat(job).then(active => {
        if (!active) superseded.abort();
      }).catch(() => superseded.abort()).finally(() => { heartbeat = undefined; });
    }, 20000) : undefined;
    lease?.unref();
    try {
      yield { event: 'conversation', data: {
        conversation_id: job.conversationId, created: job.created, user_message_id: job.user.id,
        assistant_message: job.assistant, user_message: job.user, deleted_message_ids: job.deletedIds, replayed: job.replayed,
      } };
      if (job.generationId) {
        let answer = '';
        let failed = false;
        let metadata: { responseId?: string; inputTokens?: number; outputTokens?: number } = {};
        const recent = job.history;
        let characters = 0;
        let start = recent.length;
        while (start > 0 && characters + recent[start - 1].content.length <= 48000) characters += recent[--start].content.length;
        try {
          for await (const item of this.provider(recent.slice(start), job.user.content, providerSignal, job.assistant.model || env.geminiModel)) {
            providerSignal.throwIfAborted();
            if (item.kind === 'reset') {
              answer = ''; metadata = {};
              yield { event: 'reset', data: { assistant_message_id: job.assistant.id, attempt: item.attempt } };
              continue;
            }
            const chunk = item.value;
            const text = chunk.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
            metadata.responseId = chunk.responseId ?? metadata.responseId;
            metadata.inputTokens = chunk.usageMetadata?.promptTokenCount ?? metadata.inputTokens;
            metadata.outputTokens = chunk.usageMetadata?.candidatesTokenCount ?? metadata.outputTokens;
            if (text) {
              answer += text;
              if (answer.length > 100000) throw new AiError('ai_output_too_large');
              yield { event: 'delta', data: { text } };
            }
          }
          if (!answer.trim()) throw new AiError('ai_empty_response');
        } catch (error) {
          failed = true;
          // Never expose provider messages, stack traces or request content.
          console.warn('AI generation did not complete:', { code: error instanceof AiError ? error.code : 'generation_interrupted' });
        }
        const saved = await this.store.finish(job, answer, failed, failed ? {} : metadata);
        settled = true;
        if (!saved) {
          yield { event: 'superseded', data: { assistant_message_id: job.assistant.id } };
          return;
        }
        job.assistant = saved;
      }
      yield { event: 'done', data: {
        success: true, conversation_id: job.conversationId, message: job.assistant,
        user_message: job.user, deleted_message_ids: job.deletedIds, replayed: job.replayed,
      } };
    } finally {
      if (lease) clearInterval(lease);
      superseded.abort();
      await heartbeat;
      // Also runs when the consumer disconnects while the generator is yielded.
      if (!settled && job.generationId) {
        await this.store.finish(job, '', true).catch(() => console.error('Could not finalize assistant; stale pending recovery will apply.'));
      }
    }
  }
}

function service(auth: AuthContext) { return new ChatService(new ChatRepository(auth.db, auth.userId)); }
export function sendMessage(input: SendMessageInput, auth: AuthContext, signal: AbortSignal) { return service(auth).send(input, signal); }
export function retryMessage(id: string, auth: AuthContext, signal: AbortSignal) { return service(auth).retry(id, signal); }
export function editMessage(id: string, content: string, auth: AuthContext, signal: AbortSignal) { return service(auth).edit(id, content, signal); }
