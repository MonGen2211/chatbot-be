const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AiError, retryStream, retryDelay } = require('../dist/services/ai-retry.service');
const collect = async stream => { const values = []; for await (const value of stream) values.push(value); return values; };

test('503 twice then success: exponential backoff and reset events', async () => {
  let calls = 0; const waits = [];
  const values = await collect(retryStream(async function* () {
    calls++; if (calls < 3) throw new AiError('ai_provider_error', 503); yield 'ok';
  }, new AbortController().signal, { random: () => 0, sleep: async ms => { waits.push(ms); } }));
  assert.equal(calls, 3); assert.deepEqual(waits, [500, 1000]);
  assert.deepEqual(values, [{ kind: 'reset', attempt: 2 }, { kind: 'reset', attempt: 3 }, { kind: 'chunk', value: 'ok' }]);
});
test('at most 3 retries and allowlisted HTTP errors only', async () => {
  for (const status of [429, 500, 502, 503, 529, 400, 401, 403, 404, 504]) {
    let calls = 0; const waits = [];
    await assert.rejects(collect(retryStream(async function* () { calls++; throw new AiError('ai_provider_error', status); },
      new AbortController().signal, { random: () => 0, sleep: async ms => { waits.push(ms); } })));
    const retryable = [429, 500, 502, 503, 529].includes(status);
    assert.equal(calls, retryable ? 4 : 1, String(status));
    assert.deepEqual(waits, retryable ? [500, 1000, 2000] : []);
  }
});
test('network errors and per-attempt timeout retry; user cancellation never retries', async () => {
  let calls = 0;
  await assert.rejects(collect(retryStream(async function* (signal) {
    calls++; await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, new AbortController().signal, { timeoutMs: 5, sleep: async () => undefined })), e => e.code === 'ai_timeout');
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(collect(retryStream(async function* () { calls++; throw new AiError('ai_network_error'); },
    new AbortController().signal, { sleep: async () => undefined })));
  assert.equal(calls, 4);
  const abort = new AbortController(); calls = 0;
  await assert.rejects(collect(retryStream(async function* () { calls++; abort.abort(); throw abort.signal.reason; }, abort.signal)));
  assert.equal(calls, 1);
});
test('Retry-After seconds/date wins over jitter; delays capped at 8 seconds', () => {
  assert.equal(retryDelay(0, '3', () => 1), 3000);
  assert.equal(retryDelay(0, new Date(5000).toUTCString(), () => 1, 0), 5000);
  assert.equal(retryDelay(0, '99'), 8000);
  assert.equal(retryDelay(0, 'invalid', () => 1), 625);
  assert.equal(retryDelay(10, null, () => 1), 8000);
});
