import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorize, callback } from '../auth-server/oauth.mjs';
import { authServiceURL, validSignInMessage, GITHUB_SIGN_IN_MESSAGE } from '../src/githubSignIn.js';

const env = {
  AUTH_ORIGIN: 'https://auth.example.test',
  GITHUB_APP_CLIENT_ID: 'Iv1_test',
  GITHUB_APP_CLIENT_SECRET: 'server-only-secret',
  OAUTH_STATE_KEY: Buffer.alloc(32, 4).toString('base64'),
};
const time = 1793850000000;
const now = () => time;
const clientState = 'a'.repeat(43);
const token = 'ghu_test_token';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = '') {
      this.body = body;
    },
  };
}
async function flow(origin = 'https://nbbbnbbb.github.io') {
  const result = response();
  await authorize(
    { method: 'GET', url: `/api/authorize?${new URLSearchParams({ origin, state: clientState })}` },
    result,
    { env, now },
  );
  const location = new URL(result.headers.Location);
  return {
    result,
    location,
    cookie: result.headers['Set-Cookie'].split(';')[0],
    state: location.searchParams.get('state'),
  };
}
function callbackRequest(value, changes = {}) {
  return {
    method: 'GET',
    url: `/api/callback?${new URLSearchParams({ code: 'test-code', state: value.state })}`,
    headers: { cookie: value.cookie },
    ...changes,
  };
}

test('認証開始は許可した公開ページだけを受け付け、秘密を返さずPKCEとHttpOnly Cookieを使う', async () => {
  const value = await flow();
  assert.equal(value.result.statusCode, 302);
  assert.equal(value.location.origin, 'https://github.com');
  assert.equal(value.location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(value.location.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(value.result.headers['Set-Cookie'].includes('HttpOnly; SameSite=Lax'));
  assert.ok(value.result.headers['Set-Cookie'].includes('; Secure'));
  assert.ok(!JSON.stringify(value.result.headers).includes(env.GITHUB_APP_CLIENT_SECRET));
  for (const origin of ['https://evil.test', 'https://nbbbnbbb.github.io.evil.test', 'null']) {
    const result = response();
    await authorize(
      {
        method: 'GET',
        url: `/api/authorize?origin=${encodeURIComponent(origin)}&state=${clientState}`,
      },
      result,
      { env, now },
    );
    assert.equal(result.statusCode, 400);
    assert.equal(result.headers.Location, undefined);
  }
});

test('Cookieのない・改ざん・期限切れ・state不一致のコールバックでは認証コードを交換しない', async () => {
  const value = await flow();
  let calls = 0;
  const fetcher = () => {
    calls++;
    throw new Error('must not call');
  };
  const cases = [
    [callbackRequest(value, { headers: {} }), now],
    [callbackRequest(value, { headers: { cookie: value.cookie + 'x' } }), now],
    [callbackRequest(value, { url: '/api/callback?code=code&state=forged' }), now],
    [callbackRequest(value), () => time + 11 * 60 * 1000],
  ];
  for (const [request, clock] of cases) {
    const result = response();
    await callback(request, result, { env, now: clock, fetcher });
    assert.equal(result.statusCode, 400);
    assert.ok(!result.body.includes(token));
  }
  assert.equal(calls, 0);
});

test('コード交換はこのリポジトリに限定し、本人の書込み権限を確認して短期トークンだけを元ページに返す', async () => {
  const value = await flow();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/access_token'))
      return json({ access_token: token, expires_in: 3600, refresh_token: 'never-send-refresh' });
    if (url.endsWith('/user')) return json({ login: 'nbbbnbbb' });
    return json({ id: 1445229045, permissions: { push: true } });
  };
  const result = response();
  await callback(callbackRequest(value), result, { env, now, fetcher });
  assert.equal(result.statusCode, 200);
  const body = calls[0].options.body;
  assert.equal(body.get('repository_id'), '1445229045');
  assert.equal(body.get('client_secret'), env.GITHUB_APP_CLIENT_SECRET);
  assert.equal(
    createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
    value.location.searchParams.get('code_challenge'),
  );
  assert.ok(
    calls.slice(1).every((call) => call.options.headers.Authorization === `Bearer ${token}`),
  );
  assert.ok(result.body.includes(token));
  assert.ok(result.body.includes('https://nbbbnbbb.github.io'));
  assert.ok(!result.body.includes(env.GITHUB_APP_CLIENT_SECRET));
  assert.ok(!result.body.includes('never-send-refresh'));
  assert.ok(result.headers['Content-Security-Policy'].includes("frame-ancestors 'none'"));
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(result.headers['Referrer-Policy'], 'no-referrer');
  assert.ok(result.headers['Set-Cookie'].includes('Max-Age=0'));
  assert.ok(!result.headers.Location);
});

test('別のリポジトリ・書込み権限なし・期限のないトークンではログインを許可しない', async () => {
  for (const [repository, expires] of [
    [{ id: 1445229045, permissions: { push: false } }, 3600],
    [{ id: 999, permissions: { push: true } }, 3600],
    [{ id: 1445229045, permissions: { push: true } }, undefined],
  ]) {
    const value = await flow(),
      result = response();
    const fetcher = async (url) => {
      if (url.includes('/access_token')) return json({ access_token: token, expires_in: expires });
      if (url.endsWith('/user')) return json({ login: 'visitor' });
      return json(repository);
    };
    await callback(callbackRequest(value), result, { env, now, fetcher });
    assert.ok(result.statusCode >= 400);
    assert.ok(!result.body.includes(token));
  }
});

test('未設定・不正なHTTP接続先は拒否し、GitHubのキャンセルは書き込みなしで終了する', async () => {
  const result = response();
  await authorize({ method: 'GET', url: '/' }, result, { env: {}, now });
  assert.equal(result.statusCode, 503);
  const value = await flow(),
    denied = response();
  await callback(
    callbackRequest(value, { url: `/api/callback?error=access_denied&state=${value.state}` }),
    denied,
    {
      env,
      now,
      fetcher: () => {
        throw new Error('must not call');
      },
    },
  );
  assert.equal(denied.statusCode, 200);
  assert.ok(denied.body.includes('中止'));
  assert.throws(() => authServiceURL(''), /管理者/);
  assert.throws(() => authServiceURL('http://auth.example.test'), /不正/);
  assert.throws(() => authServiceURL('https://user:password@auth.example.test'), /不正/);
  assert.equal(authServiceURL('https://auth.example.test').origin, 'https://auth.example.test');
});

test('ブラウザーは接続先・送信元ウィンドウ・state・有効期限の一致した応答だけを採用する', () => {
  const popup = {},
    origin = env.AUTH_ORIGIN;
  const event = {
    source: popup,
    origin,
    data: {
      type: GITHUB_SIGN_IN_MESSAGE,
      state: clientState,
      token,
      login: 'nbbbnbbb',
      expiresAt: time + 3600000,
    },
  };
  const expected = { popup, origin, state: clientState, now: time };
  assert.equal(validSignInMessage(event, expected), true);
  assert.equal(validSignInMessage({ ...event, origin: 'https://evil.test' }, expected), false);
  assert.equal(validSignInMessage({ ...event, source: {} }, expected), false);
  assert.equal(
    validSignInMessage({ ...event, data: { ...event.data, state: 'other' } }, expected),
    false,
  );
  assert.equal(
    validSignInMessage({ ...event, data: { ...event.data, expiresAt: time - 1 } }, expected),
    false,
  );
  assert.equal(
    validSignInMessage(
      { ...event, data: { ...event.data, token: 'shared-admin-token' } },
      expected,
    ),
    false,
  );
});
