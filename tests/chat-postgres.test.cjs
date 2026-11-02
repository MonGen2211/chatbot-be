const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { AsyncLocalStorage } = require('node:async_hooks');

test('real PostgreSQL: retry/edit atomicity, idempotency, leases and fencing', { skip: process.env.RUN_PG_INTEGRATION !== '1', timeout: 120000 }, async t => {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const { Pool } = require('pg');
  const { getPoolConfig } = require('../scripts/postgres-config.cjs');
  const { ChatRepository } = require('../dist/repositories/chat.repository');
  const { ChatService } = require('../dist/services/chat.service');
  const { MessageRepository } = require('../dist/repositories/message.repository');
  const { ConversationRepository } = require('../dist/repositories/conversation.repository');
  const { retryStream, AiError } = require('../dist/services/ai-retry.service');
  const db = new Pool(getPoolConfig(process.env.DATABASE_URL, process.env.DATABASE_CA_FILE));
  const schema = 'chat_verify_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^chat_verify_[a-f0-9]{32}$/);
  const rewrite = sql => sql.replaceAll('public.', schema + '.').replaceAll('app_private.', schema + '.');
  const requestContext = new AsyncLocalStorage();
  let failAssistant = false;
  const adapter = {
    query: (sql, values) => db.query(rewrite(sql), values),
    connect: async () => {
      const client = await db.connect();
      let context;
      return { release: () => client.release(), query: async (sql, values) => {
        if (failAssistant && sql.includes('INSERT INTO public.messages') && sql.includes("'assistant'")) {
          throw Object.assign(new Error('Injected constraint failure'), { code: '23514' });
        }
        const result = await client.query(rewrite(sql), values);
        if (sql === 'BEGIN') { context = requestContext.getStore(); if (context) context.active++; }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { if (context) context.active--; context = undefined; }
        return result;
      } };
    },
  };
  const userId = randomUUID();
  const repo = new ChatRepository(adapter, userId);
  let calls = 0; let mode = 'success';
  const provider = (_, text, signal) => retryStream(async function* () {
    assert.equal(requestContext.getStore()?.active ?? 0, 0, 'AI must run outside its request transaction'); calls++;
    if (mode === 'fail' || (mode === 'twice' && calls <= 2)) throw new AiError('ai_provider_error', 503);
    yield { candidates: [{ content: { parts: [{ text: 'Answer: ' + text }] }, finishReason: 'STOP' }] };
  }, signal, { sleep: async () => undefined });
  const service = new ChatService(repo, provider);
  const collect = iterator => requestContext.run({ active: 0 }, async () => { const out = []; for await (const item of iterator) out.push(item); return out; });
  const send = (text, conversation_id, message_id = randomUUID()) => service.send({ message_id, message: text, conversation_id }, new AbortController().signal);
  const rows = id => adapter.query('SELECT * FROM public.messages WHERE conversation_id = $1 ORDER BY sequence_no', [id]).then(r => r.rows);
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id uuid PRIMARY KEY);
      CREATE TABLE ${schema}.conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
        title text, model text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_message_at timestamptz);
      CREATE TABLE ${schema}.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES ${schema}.conversations(id),
        parent_message_id uuid REFERENCES ${schema}.messages(id), role text NOT NULL, content text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'completed',
        provider text, model text, response_id text, input_tokens integer, output_tokens integer, error_text text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`);
    await db.query(`INSERT INTO ${schema}.users(id) VALUES ($1)`, [userId]);
    await db.query(rewrite(fs.readFileSync(path.resolve(__dirname, '../migrations/002_chat_operations.sql'), 'utf8')));

    await t.test('503 twice succeeds with one user + one assistant, replay never calls AI', async () => {
      mode = 'twice'; calls = 0; const id = randomUUID();
      const result = (await collect(send('U1', undefined, id))).at(-1).data;
      assert.equal(calls, 3); assert.equal(result.message.status, 'completed'); assert.equal((await rows(result.conversation_id)).length, 2);
      await collect(send('U1', result.conversation_id, id)); assert.equal(calls, 3);
      const duplicates = await Promise.all([repo.prepareSend({ message_id: id, message: 'U1' }, 'mock'), repo.prepareSend({ message_id: id, message: 'U1' }, 'mock')]);
      assert.equal(duplicates.every(job => job.replayed), true); assert.equal((await rows(result.conversation_id)).length, 2);
      await assert.rejects(repo.prepareSend({ message_id: id, message: 'different' }, 'mock'), e => e.status === 409);
    });
    await t.test('failed blocks new sends; concurrent manual retry has one winner and reuses ID', async () => {
      mode = 'fail'; calls = 0; const clientId = randomUUID();
      const failed = (await collect(send('failed user', undefined, clientId))).at(-1).data;
      assert.equal(calls, 4); assert.equal(failed.message.status, 'failed'); assert.equal((await rows(failed.conversation_id)).length, 2);
      await assert.rejects(collect(send('blocked', failed.conversation_id)), e => e.status === 409);
      const duplicate = (await collect(send('failed user', failed.conversation_id, clientId))).at(-1).data;
      assert.equal(duplicate.message.status, 'failed'); assert.equal(calls, 4);
      const attempts = await Promise.allSettled([repo.prepareRetry(failed.message.id), repo.prepareRetry(failed.message.id)]);
      assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(attempts.find(r => r.status === 'rejected').reason.status, 409);
      const job = attempts.find(r => r.status === 'fulfilled').value;
      const completed = await repo.finish(job, 'Retried answer', false);
      assert.equal(completed.id, failed.message.id); assert.equal(completed.status, 'completed');
      assert.equal((await rows(failed.conversation_id)).length, 2);
    });
    await t.test('simultaneous first send with same client ID creates one pair and calls AI once', async () => {
      mode = 'success'; calls = 0; const id = randomUUID();
      const results = await Promise.all([collect(send('same request', undefined, id)), collect(send('same request', undefined, id))]);
      const one = results[0].at(-1).data; const two = results[1].at(-1).data;
      assert.equal(one.conversation_id, two.conversation_id); assert.equal(one.message.id, two.message.id);
      assert.equal((await rows(one.conversation_id)).length, 2); assert.equal(calls, 1);
    });
    await t.test('edit U1-A1-U2-A2 leaves edited U1 + new AI, and rolls back every DB mutation on failure', async () => {
      mode = 'success';
      const first = (await collect(send('U1'))).at(-1).data;
      const second = (await collect(send('U2', first.conversation_id))).at(-1).data;
      const before = await rows(first.conversation_id);
      failAssistant = true;
      try { await assert.rejects(repo.prepareEdit(first.user_message.id, 'rollback edit', 'mock'), e => e.status === 503); }
      finally { failAssistant = false; }
      assert.deepEqual((await rows(first.conversation_id)).map(m => [m.id, m.content]), before.map(m => [m.id, m.content]));
      const result = (await collect(service.edit(first.user_message.id, 'Edited U1', new AbortController().signal))).at(-1).data;
      const after = await rows(first.conversation_id);
      assert.equal(after.length, 2); assert.equal(after[0].id, first.user_message.id); assert.equal(after[0].content, 'Edited U1'); assert.equal(after[0].is_edited, true);
      assert.notEqual(after[1].id, first.message.id); assert.equal(after[1].status, 'completed');
      assert.deepEqual(new Set(result.deleted_message_ids), new Set([first.message.id, second.user_message.id, second.message.id]));
      const outsider = new ChatRepository(adapter, randomUUID());
      await assert.rejects(outsider.prepareEdit(first.user_message.id, 'bad', 'mock'), e => e.status === 404);
      await assert.rejects(outsider.prepareRetry(after[1].id), e => e.status === 404);
    });
    await t.test('edit deletes active pending; late result and expired generation cannot write', async () => {
      const original = await repo.prepareSend({ message_id: randomUUID(), message: 'old prompt' }, 'mock');
      const edited = await repo.prepareEdit(original.user.id, 'new prompt', 'mock');
      assert.equal(await repo.finish(original, 'LATE OLD ANSWER', false), null);
      assert.ok(edited.deletedIds.includes(original.assistant.id));
      await repo.finish(edited, 'New answer', false);
      const stale = await repo.prepareSend({ message_id: randomUUID(), message: 'stale' }, 'mock');
      await adapter.query("UPDATE public.messages SET updated_at = now() - interval '3 minutes' WHERE id = $1", [stale.assistant.id]);
      const list = await new MessageRepository(adapter, userId, new AbortController().signal).listMessages(stale.conversationId, { limit: 50, offset: 0 });
      assert.equal(list.messages.find(m => m.id === stale.assistant.id).status, 'failed');
      assert.equal(await repo.finish(stale, 'LATE STALE ANSWER', false), null);
      const retried = await repo.prepareRetry(stale.assistant.id);
      assert.equal(await repo.finish(stale, 'OLD WORKER', false), null);
      await repo.finish(retried, 'Fresh worker', false);
      assert.equal((await rows(stale.conversationId)).length, 2);
    });
    await t.test('rename/delete conversation require ownership; delete removes messages and fences late AI', async () => {
      const job = await repo.prepareSend({ message_id: randomUUID(), message: 'delete this conversation' }, 'mock');
      const conversations = new ConversationRepository(adapter, userId, new AbortController().signal);
      const outsider = new ConversationRepository(adapter, randomUUID(), new AbortController().signal);
      await assert.rejects(outsider.rename(job.conversationId, 'not mine'), e => e.status === 404);
      await assert.rejects(outsider.delete(job.conversationId), e => e.status === 404);
      const renamed = await conversations.rename(job.conversationId, 'Renamed');
      assert.equal(renamed.conversation.title, 'Renamed');
      const deleted = await conversations.delete(job.conversationId);
      assert.deepEqual(new Set(deleted.deleted_message_ids), new Set([job.user.id, job.assistant.id]));
      assert.equal((await rows(job.conversationId)).length, 0);
      assert.equal(await repo.finish(job, 'LATE ANSWER', false), null);
      await assert.rejects(conversations.findOwned(job.conversationId), e => e.status === 404);
      await assert.rejects(repo.prepareSend({ message_id: job.user.id, message: 'delete this conversation' }, 'mock'), e => e.status === 404);
    });

  } finally {
    assert.match(schema, /^chat_verify_[a-f0-9]{32}$/);
    try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await db.end(); }
  }
});
