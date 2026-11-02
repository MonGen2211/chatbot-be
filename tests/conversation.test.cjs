const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?sslmode=disable';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-bytes';
const { ChatService } = require('../dist/services/chat.service');
const { AiError, retryStream } = require('../dist/services/ai-retry.service');
const { validateConversationTitle } = require('../dist/validators/conversation.validator');
const collect = async stream => { const values = []; for await (const value of stream) values.push(value); return values; };
const chunk = text => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
test('rename validates title and trims surrounding whitespace', () => {
  assert.equal(validateConversationTitle({ title: '  New title  ' }), 'New title');
  for (const input of [null, [], {}, { title: '' }, { title: '  ' }, { title: 'x'.repeat(201) }]) {
    assert.throws(() => validateConversationTitle(input), error => error.status === 400);
  }
});
function fixture() {
  const user = { id: randomUUID(), conversation_id: randomUUID(), role: 'user', content: 'Node.js?', status: 'completed' };
  const job = { conversationId: user.conversation_id, user, assistant: { id: randomUUID(), role: 'assistant', status: 'pending', content: '', model: 'mock' }, generationId: randomUUID(), history: [], deletedIds: [], replayed: false, created: true };
  const writes = [];
  const store = {
    prepareSend: async () => job, prepareRetry: async () => job, prepareEdit: async () => job,
    heartbeat: async () => true,
    finish: async (current, content, failed) => { writes.push({ current, content, failed }); return { ...current.assistant, content: failed ? '' : content, status: failed ? 'failed' : 'completed' }; },
  };
  return { job, store, writes };
}
test('automatic retries have one prepared user and assistant; final response succeeded', async () => {
  const { job, store, writes } = fixture(); let prepares = 0; let calls = 0;
  store.prepareSend = async () => { prepares++; return job; };
  const provider = (_, __, signal) => retryStream(async function* () { calls++; if (calls < 3) throw new AiError('ai_provider_error', 503); yield chunk('Success'); }, signal, { sleep: async () => undefined });
  const events = await collect(new ChatService(store, provider).send({ message_id: job.user.id, message: job.user.content }, new AbortController().signal));
  assert.equal(prepares, 1); assert.equal(calls, 3); assert.equal(writes.length, 1);
  assert.equal(writes[0].current.assistant.id, job.assistant.id);
  assert.equal(events.at(-1).event, 'done'); assert.equal(events.at(-1).data.message.status, 'completed');
});
test('all retries fail: user preserved and assistant failed with successful done, no provider details', async () => {
  const { job, store, writes } = fixture(); let calls = 0;
  const provider = (_, __, signal) => retryStream(async function* () { calls++; throw new AiError('ai_provider_error', 503); }, signal, { sleep: async () => undefined });
  const events = await collect(new ChatService(store, provider).send({ message_id: job.user.id, message: job.user.content }, new AbortController().signal));
  assert.equal(calls, 4); assert.equal(writes.length, 1); assert.equal(events.at(-1).data.success, true);
  assert.equal(events.at(-1).data.message.status, 'failed'); assert.equal(events.at(-1).data.user_message.content, 'Node.js?');
  assert.equal(events.some(e => e.event === 'error'), false); assert.equal(JSON.stringify(events).includes('stack'), false);
});
test('manual retry updates the same assistant; idempotent replay does not call provider', async () => {
  const { job, store, writes } = fixture(); let calls = 0;
  const provider = (_, __, signal) => retryStream(async function* () { calls++; yield chunk('Retried'); }, signal);
  const events = await collect(new ChatService(store, provider).retry(job.assistant.id, new AbortController().signal));
  assert.equal(events.at(-1).data.message.id, job.assistant.id); assert.equal(writes.length, 1);
  job.generationId = undefined; job.replayed = true;
  const replay = await collect(new ChatService(store, provider).send({ message_id: job.user.id, message: job.user.content }, new AbortController().signal));
  assert.equal(replay.at(-1).data.replayed, true); assert.equal(calls, 1); assert.equal(writes.length, 1);
});
test('edit commits prepared mutation before AI, returns edited user/new assistant/deleted IDs', async () => {
  const { job, store, writes } = fixture(); const deleted = [randomUUID(), randomUUID(), randomUUID()]; let committed = false;
  store.prepareEdit = async (id, text) => { assert.equal(id, job.user.id); job.user = { ...job.user, content: text, is_edited: true }; job.deletedIds = deleted; committed = true; return job; };
  const provider = (_, text, signal) => retryStream(async function* () { assert.equal(committed, true); assert.equal(text, 'Edited'); yield chunk('New answer'); }, signal);
  const events = await collect(new ChatService(store, provider).edit(job.user.id, 'Edited', new AbortController().signal));
  const result = events.at(-1).data;
  assert.equal(result.user_message.is_edited, true); assert.equal(result.user_message.content, 'Edited');
  assert.deepEqual(result.deleted_message_ids, deleted); assert.equal(result.message.id, job.assistant.id); assert.equal(writes.length, 1);
});
test('late generation discarded by fencing, and partial stream resets before retry output', async () => {
  const { job, store, writes } = fixture(); let calls = 0;
  const provider = (_, __, signal) => retryStream(async function* () { calls++; yield chunk(calls === 1 ? 'Partial' : 'Final'); if (calls === 1) throw new AiError('ai_network_error'); }, signal, { sleep: async () => undefined });
  const events = await collect(new ChatService(store, provider).send({ message_id: job.user.id, message: job.user.content }, new AbortController().signal));
  assert.equal(writes[0].content, 'Final'); assert.equal(events.some(e => e.event === 'reset'), true);
  store.finish = async () => null;
  const late = await collect(new ChatService(store, provider).retry(job.assistant.id, new AbortController().signal));
  assert.equal(late.at(-1).event, 'superseded'); assert.equal(late.some(e => e.event === 'done'), false);
});
