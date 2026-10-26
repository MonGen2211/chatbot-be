const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

test('registration forwards credentials and handles Supabase responses', async () => {
  const requests = [];
  let scenario = 'confirmed';
  const user = { id: 'test-user', email: 'new@example.com', aud: 'authenticated', created_at: new Date().toISOString() };
  const session = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user };
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Supabase-Api-Version', '2024-01-01');
    const errors = {
      duplicate: [422, 'user_already_exists'],
      weak: [422, 'weak_password'],
      disabled: [403, 'signup_disabled'],
      limited: [429, 'over_email_send_rate_limit'],
      invalidEmail: [400, 'email_address_invalid'],
      key: [401, 'invalid_api_key'],
      down: [500, 'unexpected_failure'],
      unknown: [404, 'unexpected_failure'],
    };
    if (errors[scenario]) {
      const [status, code] = errors[scenario];
      res.writeHead(status);
      res.end(JSON.stringify({ code, error_code: code, msg: 'Mock error' }));
      return;
    }
    const result = scenario === 'confirmed' || scenario === 'login'
      ? session
      : scenario === 'obfuscated' ? { ...user, identities: [] } : user;
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mock';
  process.env.NODE_ENV = 'production';
  const { app } = require('../dist/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(body, route = 'register') {
    return fetch(`${base}/api/auth/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  try {
    const input = { email: ' new@example.com ', password: ' StrongPassword123! ', role: 'admin' };
    let response = await post(input);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    let result = await response.json();
    assert.equal(result.data.session.access_token, 'test-access');
    assert.equal(result.data.email_confirmation_required, false);
    assert.equal(requests[0].url, '/auth/v1/signup');
    assert.equal(requests[0].body.email, 'new@example.com');
    assert.equal(requests[0].body.password, input.password);
    assert.equal(requests[0].body.role, undefined);
    assert.equal(requests[0].body.email_confirm, undefined);

    for (scenario of ['pending', 'obfuscated']) {
      response = await post(input);
      assert.equal(response.status, 202);
      result = await response.json();
      assert.equal(result.data.session, null);
      assert.equal(result.data.user, null);
      assert.equal(result.data.email_confirmation_required, true);
    }
    const callsBeforeValidation = requests.length;
    for (const invalid of [null, [], {}, { email: 'bad', password: 'password123' }, { email: user.email, password: 'short' }, { email: user.email, password: 12345678 }]) {
      assert.equal((await post(invalid)).status, 400);
    }
    assert.equal(requests.length, callsBeforeValidation);

    for (const [name, status, code] of [
      ['duplicate', 409, 'email_exists'], ['weak', 400, 'weak_password'],
      ['disabled', 403, 'signup_disabled'], ['limited', 429, 'auth_rate_limited'],
      ['invalidEmail', 400, 'invalid_signup_email'], ['key', 503, 'auth_unavailable'],
      ['down', 503, 'auth_unavailable'], ['unknown', 502, 'auth_upstream_error'],
    ]) {
      scenario = name;
      response = await post(input);
      assert.equal(response.status, status, name);
      assert.equal((await response.json()).code, code, name);
    }
    scenario = 'login';
    response = await post(input, 'login');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.session.access_token, 'test-access');
    assert.equal(requests.at(-1).url, '/auth/v1/token?grant_type=password');
  } finally {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise(resolve => server.close(resolve)),
      new Promise(resolve => upstream.close(resolve)),
    ]);
  }
});
