import { setTimeout as delay } from 'node:timers/promises';

export class AiError extends Error {
  constructor(public readonly code: string, public readonly status?: number, public readonly retryAfter?: string | null) {
    super(code);
  }
}
const retryStatuses = new Set([429, 500, 502, 503, 529]);
export function canRetry(error: unknown) {
  return error instanceof AiError && (error.code === 'ai_network_error' || error.code === 'ai_timeout'
    || (error.status !== undefined && retryStatuses.has(error.status)));
}
export function retryDelay(attempt: number, header?: string | null, random = Math.random, now = Date.now()) {
  if (header) {
    const seconds = /^\d+(\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
    const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
    if (Number.isFinite(wait)) return Math.min(8000, Math.max(0, wait));
  }
  const base = Math.min(8000, 500 * 2 ** attempt);
  return Math.min(8000, base + random() * base * 0.25);
}
export type RetryChunk<T> = { kind: 'chunk'; value: T } | { kind: 'reset'; attempt: number };
export interface RetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  random?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export async function* retryStream<T>(factory: (signal: AbortSignal) => AsyncIterable<T>, signal: AbortSignal, options: RetryOptions = {}): AsyncGenerator<RetryChunk<T>> {
  const sleep = options.sleep ?? ((ms, abort) => delay(ms, undefined, { signal: abort }));
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new AiError('ai_timeout')), options.timeoutMs ?? 30000);
    const attemptSignal = AbortSignal.any([signal, timeout.signal]);
    let failure: unknown;
    try {
      for await (const value of factory(attemptSignal)) {
        attemptSignal.throwIfAborted();
        yield { kind: 'chunk', value };
      }
      attemptSignal.throwIfAborted();
      return;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      failure = timeout.signal.aborted ? new AiError('ai_timeout') : error;
    } finally {
      clearTimeout(timer);
      timeout.abort();
    }
    if (attempt >= (options.maxRetries ?? 3) || !canRetry(failure)) throw failure;
    await sleep(retryDelay(attempt, (failure as AiError).retryAfter, options.random), signal);
    yield { kind: 'reset', attempt: attempt + 2 };
  }
}
