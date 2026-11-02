const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?sslmode=disable';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-bytes';
process.env.GEMINI_API_KEY = 'mock-only';
const { streamGemini } = require('../dist/services/gemini.service');
const collect = async stream => { const events = []; for await (const item of stream) events.push(item); return events; };

test('mock Gemini HTTP API retries transient errors; never retries permanent 4xx', async () => {
  const original = global.fetch;
  try {
    let calls = 0; const waits = [];
    global.fetch = async () => {
      calls++;
      if (calls < 3) return new Response('upstream-sensitive-details', { status: 503, headers: { 'Retry-After': '1' } });
      return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }) + '\n\n');
    };
    const result = await collect(streamGemini([], 'Node.js?', new AbortController().signal, 'mock', { sleep: async ms => { waits.push(ms); } }));
    assert.equal(calls, 3); assert.deepEqual(waits, [1000, 1000]); assert.equal(result.at(-1).value.candidates[0].content.parts[0].text, 'OK');
    for (const status of [400, 401, 403, 404]) {
      calls = 0;
      global.fetch = async () => { calls++; return new Response('sensitive upstream body', { status }); };
      await assert.rejects(collect(streamGemini([], 'test', new AbortController().signal, 'mock', { sleep: async () => undefined })), e => e.status === status && !e.message.includes('sensitive'));
      assert.equal(calls, 1);
    }
  } finally { global.fetch = original; }
});
