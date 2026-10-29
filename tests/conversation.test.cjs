const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');

test('PostgreSQL chat ownership, pagination, Gemini streaming and cancellation', async t => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?sslmode=disable';
  process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-bytes';
  process.env.GEMINI_API_KEY = 'mock-gemini-key';
  const conversations = [];
  const messages = [];
  const user = { id: randomUUID(), email: 'test@example.com', token_version: 0, email_verified: true, deleted_at: null, banned_until: null };
  const queries = [];
  let mode = 'success';
  let release;
  let cancelled = false;
  const originalQuery = Pool.prototype.query;
  Pool.prototype.query = async function(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('FROM app_private.users WHERE id')) return { rows: values[0] === user.id ? [user] : [] };
    if (sql.startsWith('INSERT INTO public.conversations')) {
      const row = { id: randomUUID(), user_id: values[0], title: values[1], model: values[2], updated_at: new Date().toISOString() };
      conversations.push(row); return { rows: [row] };
    }
    if (sql.startsWith('SELECT id FROM public.conversations')) return { rows: conversations.filter(c => c.id === values[0] && c.user_id === values[1]) };
    if (sql.includes('FROM public.conversations WHERE user_id')) return { rows: conversations.filter(c => c.user_id === values[0]).slice(values[2], values[2] + values[1]) };
    if (sql.startsWith('INSERT INTO public.messages')) {
      if (!conversations.some(c => c.id === values[0] && c.user_id === values[1])) return { rows: [] };
      const row = { id: randomUUID(), conversation_id: values[0], role: values[2], content: values[3], parent_message_id: values[4], status: 'completed', created_at: new Date().toISOString() };
      messages.push(row); return { rows: [row] };
    }
    if (sql.includes('FROM public.messages')) {
      if (!conversations.some(c => c.id === values[0] && c.user_id === values[1])) return { rows: [] };
      const rows = messages.filter(m => m.conversation_id === values[0]);
      return { rows: sql.includes('LIMIT 40') ? rows.slice(-40).reverse() : rows.slice(values[3], values[3] + values[2]) };
    }
    return { rows: [] };
  };
  const originalFetch = global.fetch;
  const requests = [];
  const frame = chunk => new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, options);
    requests.push(JSON.parse(options.body));
    if (mode === 'quota') return new Response('{}', { status: 429 });
    if (mode === 'incomplete') return new Response(frame({ candidates: [{ content: { parts: [{ text: 'Partial' }] } }] }));
    if (mode === 'slow') return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame({ candidates: [{ content: { parts: [{ text: 'First' }] } }] }));
      release = () => { if (options.signal.aborted) return; controller.enqueue(frame({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Second' }] } }] })); controller.close(); };
      options.signal.addEventListener('abort', () => { cancelled = true; controller.error(options.signal.reason); }, { once: true });
    }, cancel() { cancelled = true; } }));
    return new Response(frame({ candidates: [{ content: { parts: [{ text: 'Xin chào!' }] }, finishReason: 'STOP' }] }));
  };
  const { app } = require('../dist/app');
  const { createSession } = require('../dist/services/token.service');
  const token = createSession(user).access_token;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (body, bearer = token, signal) => originalFetch(base + '/api/conversations/send-messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body), signal,
  });
  const events = text => text.trim().split('\n\n').map(s => ({ event: s.split('\n')[0].slice(7), data: JSON.parse(s.split('\n')[1].slice(6)) }));
  const get = route => originalFetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
  try {
    assert.equal((await send({ message: 'hi' }, 'invalid')).status, 401);
    assert.equal((await send({ message: ' ' })).status, 400);
    let response = await send({ message: "hello'; DROP TABLE messages; --", user_id: randomUUID() });
    assert.equal(response.status, 200);
    let result = events(await response.text());
    const id = result[0].data.conversation_id;
    assert.deepEqual(result.map(e => e.event), ['conversation', 'delta', 'done']);
    assert.equal(conversations[0].user_id, user.id);
    assert.equal(messages.length, 2);
    assert.ok(!queries.some(q => q.sql.includes('DROP TABLE')));
    assert.ok(queries.some(q => q.values.includes("hello'; DROP TABLE messages; --")));
    assert.ok(requests[0].systemInstruction.parts[0].text.includes('AI có thể mắc sai lầm'));
    response = await send({ message: 'next', conversation_id: id });
    result = events(await response.text());
    assert.equal(result[0].data.created, false);
    assert.equal(conversations.length, 1);
    assert.deepEqual(requests.at(-1).contents.map(m => m.role), ['user', 'model', 'user']);
    const foreign = { id: randomUUID(), user_id: randomUUID() }; conversations.push(foreign);
    const calls = requests.length;
    assert.equal((await send({ message: 'hi', conversation_id: foreign.id })).status, 404);
    assert.equal((await get(`/api/conversations/${foreign.id}/messages`)).status, 404);
    assert.equal(requests.length, calls);
    response = await get('/api/conversations?limit=1&offset=0');
    assert.equal((await response.json()).data.conversations[0].id, id);
    response = await get(`/api/conversations/${id}/messages?limit=1&offset=0`);
    const page = (await response.json()).data;
    assert.equal(page.messages.length, 1); assert.equal(page.pagination.has_more, true);
    for (mode of ['quota', 'incomplete']) {
      const count = messages.filter(m => m.role === 'assistant').length;
      const stream = events(await (await send({ message: 'failure', conversation_id: id })).text());
      assert.equal(stream.at(-1).event, 'error');
      assert.equal(messages.filter(m => m.role === 'assistant').length, count);
    }
    mode = 'slow';
    response = await send({ message: 'stream', conversation_id: id });
    let reader = response.body.getReader(); let partial = '';
    while (!partial.includes('event: delta')) partial += new TextDecoder().decode((await reader.read()).value);
    assert.ok(!partial.includes('event: done'));
    assert.equal((await send({ message: 'overlap', conversation_id: id })).status, 409);
    release(); while (!(await reader.read()).done) {}
    const abort = new AbortController();
    response = await send({ message: 'cancel', conversation_id: id }, token, abort.signal);
    reader = response.body.getReader(); partial = '';
    while (!partial.includes('event: delta')) partial += new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    const deadline = Date.now() + 2000;
    while (!cancelled) { if (Date.now() > deadline) throw new Error('Cancellation timed out'); await new Promise(r => setTimeout(r, 10)); }
    mode = 'success';
    let retry;
    do {
      retry = await send({ message: 'retry', conversation_id: id });
      if (retry.status !== 409) break;
      await retry.text();
      if (Date.now() > deadline) throw new Error('Conversation lock was not released');
      await new Promise(r => setTimeout(r, 10));
    } while (true);
    assert.equal(events(await retry.text()).at(-1).event, 'done');
  } finally {
    global.fetch = originalFetch; Pool.prototype.query = originalQuery;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
