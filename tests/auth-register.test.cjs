const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

test('PostgreSQL registration/login, transactions and local JWT authentication', async () => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test?sslmode=disable';
  process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-bytes';
  process.env.JWT_EXPIRES_IN = '1h';
  let users = [];
  let profileFailure = false;
  let before;
  const calls = [];
  const originalQuery = Pool.prototype.query;
  const originalConnect = Pool.prototype.connect;
  async function mockQuery(sql, values = []) {
    calls.push({ sql, values });
    if (sql === 'BEGIN') before = users.slice();
    if (sql === 'ROLLBACK') users = before;
    if (sql.startsWith('INSERT INTO app_private.users')) {
      if (users.some(user => user.email === values[0].toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' });
      const user = { id: randomUUID(), email: values[0].toLowerCase(), password_hash: values[1], email_verified: true, banned_until: null, deleted_at: null, token_version: 0 };
      users.push(user); return { rows: [user] };
    }
    if (sql.startsWith('INSERT INTO public.profiles') && profileFailure) throw Object.assign(new Error('profile failed'), { code: '23503' });
    if (sql.includes('FROM app_private.users WHERE lower(email)')) return { rows: users.filter(user => user.email === values[0].toLowerCase()) };
    if (sql.includes('FROM app_private.users WHERE id')) return { rows: users.filter(user => user.id === values[0]) };
    return { rows: [] };
  }
  Pool.prototype.query = mockQuery;
  Pool.prototype.connect = async () => ({ query: mockQuery, release() {} });
  const { app } = require('../dist/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const credentials = { email: 'Test@Example.com', password: 'StrongPassword123!' };
    let response = await post('/api/auth/register', credentials);
    assert.equal(response.status, 201);
    const registration = await response.json();
    assert.equal(registration.data.email_confirmation_required, false);
    assert.equal(registration.data.session.refresh_token, undefined);
    assert.notEqual(users[0].password_hash, credentials.password);
    assert.equal(await bcrypt.compare(credentials.password, users[0].password_hash), true);
    assert.equal(calls.some(call => call.sql === 'COMMIT'), true);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO public.profiles')), true);
    const token = registration.data.session.access_token;
    const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'ai-chat-be', audience: 'ai-chat-ui' });
    assert.equal(claims.sub, users[0].id);
    assert.equal(claims.ver, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    response = await post('/api/auth/login', { ...credentials, email: 'test@example.com' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.user.id, users[0].id);
    assert.equal((await post('/api/auth/register', credentials)).status, 409);
    assert.equal((await post('/api/auth/login', { ...credentials, password: 'wrong' })).status, 401);
    assert.equal((await post('/api/auth/login', { ...credentials, email: 'missing@example.com' })).status, 401);
    for (const body of [null, [], {}, { email: 'bad', password: credentials.password }, { ...credentials, password: 'short' }, { ...credentials, password: 'a'.repeat(73) }]) {
      assert.equal((await post('/api/auth/register', body)).status, 400);
    }
    profileFailure = true;
    assert.equal((await post('/api/auth/register', { ...credentials, email: 'rollback@example.com' })).status, 409);
    assert.equal(users.length, 1);
    profileFailure = false;
    for (const [field, value, status] of [['email_verified', false, 403], ['banned_until', '2999-01-01T00:00:00Z', 403], ['deleted_at', '2026-01-01T00:00:00Z', 401]]) {
      const old = users[0][field]; users[0][field] = value;
      assert.equal((await post('/api/auth/login', credentials)).status, status);
      users[0][field] = old;
    }
    assert.equal((await fetch(base + '/api/conversations', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    const expired = jwt.sign({ ver: 0 }, process.env.JWT_SECRET, { subject: users[0].id, issuer: 'ai-chat-be', audience: 'ai-chat-ui', expiresIn: -1 });
    const wrongIssuer = jwt.sign({ ver: 0 }, process.env.JWT_SECRET, { subject: users[0].id, issuer: 'supabase', audience: 'ai-chat-ui', expiresIn: 60 });
    for (const bad of [expired, wrongIssuer, token + 'bad']) assert.equal((await fetch(base + '/api/conversations', { headers: { Authorization: `Bearer ${bad}` } })).status, 401);
    users[0].token_version++;
    assert.equal((await fetch(base + '/api/conversations', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    Pool.prototype.query = originalQuery; Pool.prototype.connect = originalConnect;
  }
});
