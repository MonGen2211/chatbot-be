const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

test('send messages: ownership, persistence, streaming, failures and cancellation', async t => {
  const conversations = [];
  const messages = [];
  const geminiRequests = [];
  const userId = randomUUID();
  let mode = 'success';
  let release;
  let cancelled = false;
  let createError;
  const mockDb = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/auth/v1/user') {
      if (req.headers.authorization !== 'Bearer good-token') {
        res.writeHead(401); res.end(JSON.stringify({ msg: 'invalid JWT' })); return;
      }
      res.end(JSON.stringify({ id: userId, email: 'test@example.com', aud: 'authenticated' })); return;
    }
    // Authentication uses the user token; DB calls use the server key, not that token.
    if (req.headers.apikey !== 'sb_secret_mock' || req.headers.authorization === 'Bearer good-token') {
      res.writeHead(403); res.end(JSON.stringify({ code: '42501', message: 'wrong database client' })); return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const table = url.pathname.split('/').at(-1);
    if (table === 'conversations') {
      if (req.method === 'POST') {
        if (createError) {
          res.writeHead(400); res.end(JSON.stringify(createError)); return;
        }
        const row = { ...body, id: randomUUID() };
        conversations.push(row); res.writeHead(201); res.end(JSON.stringify(row)); return;
      }
      const id = url.searchParams.get('id')?.slice(3);
      const owner = url.searchParams.get('user_id')?.slice(3);
      const row = conversations.find(item => item.id === id && item.user_id === owner);
      if (req.method === 'PATCH') {
        if (row) Object.assign(row, body);
        res.writeHead(204); res.end(); return;
      }
      res.end(JSON.stringify(row ? [row] : [])); return;
    }
    if (table === 'messages') {
      if (req.method === 'POST') {
        const row = { ...body, id: randomUUID(), created_at: new Date().toISOString() };
        messages.push(row); res.writeHead(201); res.end(JSON.stringify(row)); return;
      }
      const id = url.searchParams.get('conversation_id')?.slice(3);
      res.end(JSON.stringify(messages.filter(item => item.conversation_id === id).slice(-40).reverse())); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => mockDb.listen(0, '127.0.0.1', resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockDb.address().port}`;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mock';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_mock';
  process.env.GEMINI_API_KEY = 'gemini_mock';
  process.env.GEMINI_MODEL = 'gemini-mock';
  process.env.NODE_ENV = 'production';
  const originalFetch = global.fetch;
  const encode = new TextEncoder();
  const frame = chunk => encode.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, options);
    geminiRequests.push(JSON.parse(options.body));
    assert.equal(options.headers['x-goog-api-key'], 'gemini_mock');
    assert.ok(String(url).endsWith(':streamGenerateContent?alt=sse'));
    if (mode === 'quota') return new Response('{}', { status: 429 });
    if (mode === 'incomplete') return new Response(frame({ candidates: [{ content: { parts: [{ text: 'Partial' }] } }] }));
    if (mode === 'blocked') return new Response(frame({ promptFeedback: { blockReason: 'SAFETY' } }));
    if (mode === 'invalid') return new Response('data: {broken}\n\n');
    if (mode === 'slow') {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frame({ candidates: [{ content: { parts: [{ text: 'First' }] } }] }));
          release = () => {
            if (options.signal.aborted) return;
            controller.enqueue(frame({ candidates: [{ content: { parts: [{ text: 'Second' }] }, finishReason: 'STOP' }] }));
            controller.close();
          };
          options.signal.addEventListener('abort', () => { cancelled = true; controller.error(options.signal.reason); }, { once: true });
        },
        cancel() { cancelled = true; },
      }));
    }
    const first = frame({ candidates: [{ content: { parts: [{ text: 'Xin chào ' }] } }], responseId: 'provider-response' });
    const last = frame({ candidates: [{ content: { parts: [{ text: 'bạn!', thought: false }, { text: 'private thought', thought: true }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 } });
    const bytes = Buffer.concat([first, last]);
    // Split inside UTF-8 characters and SSE separators.
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3));
      controller.close();
    } }));
  };
  const { app } = require('../dist/app');
  const { env } = require('../dist/config/env');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (body, token = 'good-token', signal) => originalFetch(`${base}/api/conversations/send-messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal,
  });
  const parse = text => text.trim().split('\n\n').filter(Boolean).map(frame => ({
    event: frame.split('\n')[0].slice(7), data: JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6)),
  }));
  async function waitUntil(check) {
    const deadline = Date.now() + 2000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for cancellation');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    await t.test('authentication and validation do not write to database', async () => {
      assert.equal((await send({ message: 'hello' }, '')).status, 401);
      assert.equal((await send({ message: 'hello' }, 'expired')).status, 401);
      for (const input of [{}, { message: '  ' }, { message: 'x'.repeat(12001) }, { message: 'hi', conversation_id: 'bad-id' }]) {
        assert.equal((await send(input)).status, 400);
      }
      assert.equal(conversations.length, 0);
      assert.equal(geminiRequests.length, 0);
    });
    let id;
    await t.test('database errors identify grants, foreign keys and check constraints before Gemini', async () => {
      const calls = geminiRequests.length;
      for (const [code, status, expected] of [
        ['42501', 403, 'database_permission_denied'],
        ['23503', 409, 'database_foreign_key_violation'],
        ['23514', 503, 'database_check_violation'],
        ['23502', 503, 'database_not_null_violation'],
        ['PGRST204', 503, 'database_schema_mismatch'],
      ]) {
        createError = { code, message: 'Mock database error' };
        try {
          const response = await send({ message: 'hello' });
          assert.equal(response.status, status);
          assert.equal((await response.json()).code, expected);
        } finally { createError = undefined; }
      }
      assert.equal(conversations.length, 0);
      assert.equal(geminiRequests.length, calls);
    });
    await t.test('creates one conversation and stores user and full assistant output', async () => {
      const response = await send({ message: 'hello', user_id: randomUUID() });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').startsWith('text/event-stream'));
      const events = parse(await response.text());
      assert.deepEqual(events.map(item => item.event), ['conversation', 'delta', 'delta', 'done']);
      id = events[0].data.conversation_id;
      assert.equal(events[0].data.created, true);
      assert.equal(conversations.length, 1);
      assert.equal(conversations[0].user_id, userId);
      assert.equal(messages[0].content, 'hello');
      assert.equal(messages[1].content, 'Xin chào bạn!');
      assert.equal(messages[1].parent_message_id, messages[0].id);
      assert.equal(messages[1].input_tokens, 12);
      assert.equal(messages[1].output_tokens, 8);
      assert.equal(messages[1].response_id, 'provider-response');
      assert.equal(events.at(-1).data.message.id, messages[1].id);
    });
    await t.test('reuses owned conversation and sends history as user/model roles', async () => {
      const response = await send({ message: 'next', conservation_id: id });
      assert.equal(response.status, 200);
      const events = parse(await response.text());
      assert.equal(events[0].data.created, false);
      assert.equal(conversations.length, 1);
      assert.deepEqual(geminiRequests.at(-1).contents.map(item => item.role), ['user', 'model', 'user']);
      assert.equal(geminiRequests.at(-1).contents.at(-1).parts[0].text, 'next');
    });
    await t.test('missing or foreign conversation cannot create messages or call Gemini', async () => {
      const foreign = { id: randomUUID(), user_id: randomUUID() }; conversations.push(foreign);
      const calls = geminiRequests.length; const count = messages.length;
      for (const conversation_id of [foreign.id, randomUUID()]) assert.equal((await send({ message: 'hi', conversation_id })).status, 404);
      assert.equal(geminiRequests.length, calls); assert.equal(messages.length, count);
    });
    await t.test('missing Gemini key does not create a conversation', async () => {
      const count = conversations.length; env.geminiApiKey = '';
      try { assert.equal((await send({ message: 'hello' })).status, 503); }
      finally { env.geminiApiKey = 'gemini_mock'; }
      assert.equal(conversations.length, count);
    });
    await t.test('provider failures emit error, not done, and do not save partial assistant output', async () => {
      for (mode of ['quota', 'incomplete', 'blocked', 'invalid']) {
        const count = messages.filter(item => item.role === 'assistant').length;
        const response = await send({ message: 'hello' });
        const events = parse(await response.text());
        assert.equal(events[0].event, 'conversation', mode);
        assert.equal(events.at(-1).event, 'error', mode);
        assert.ok(!events.some(item => item.event === 'done'), mode);
        assert.equal(messages.filter(item => item.role === 'assistant').length, count, mode);
      }
    });
    await t.test('delivers first delta before completion and prevents overlapping turns', async () => {
      mode = 'slow';
      const response = await send({ message: 'stream now', conversation_id: id });
      const reader = response.body.getReader(); let received = '';
      while (!received.includes('event: delta')) received += new TextDecoder().decode((await reader.read()).value);
      assert.ok(received.includes('First')); assert.ok(!received.includes('event: done'));
      assert.equal((await send({ message: 'overlap', conversation_id: id })).status, 409);
      release();
      while (true) { const { done, value } = await reader.read(); if (done) break; received += new TextDecoder().decode(value); }
      assert.equal(parse(received).at(-1).event, 'done');
    });
    await t.test('disconnect aborts provider and releases conversation lock', async () => {
      mode = 'slow'; cancelled = false;
      const abort = new AbortController();
      const response = await send({ message: 'cancel me', conversation_id: id }, 'good-token', abort.signal);
      const reader = response.body.getReader(); let received = '';
      while (!received.includes('event: delta')) received += new TextDecoder().decode((await reader.read()).value);
      const count = messages.filter(item => item.role === 'assistant').length;
      abort.abort(); await waitUntil(() => cancelled);
      assert.equal(messages.filter(item => item.role === 'assistant').length, count);
      mode = 'success';
      const retry = await send({ message: 'try again', conversation_id: id });
      assert.equal(retry.status, 200); assert.equal(parse(await retry.text()).at(-1).event, 'done');
    });
  } finally {
    global.fetch = originalFetch;
    server.closeAllConnections(); mockDb.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => mockDb.close(resolve))]);
  }
});
