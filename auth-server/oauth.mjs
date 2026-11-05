import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const REPOSITORY = 'nbbbnbbb/exhibition-simulator';
const REPOSITORY_ID = 1445229045;
const APP_ORIGIN = 'https://nbbbnbbb.github.io';
const MESSAGE = 'ma:github-sign-in';
const STATE_LIFETIME = 10 * 60 * 1000;

function settings(env) {
  const origin = new URL(env.AUTH_ORIGIN);
  const local =
    env.ALLOW_LOCAL_AUTH === '1' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (
    (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  )
    throw new Error('認証サーバーのURL設定を確認してください');
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET)
    throw new Error('管理者によるGitHub Appの設定が必要です');
  const key = Buffer.from(env.OAUTH_STATE_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('管理者による認証キーの設定が必要です');
  return {
    origin: origin.origin,
    local,
    key,
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    cookieName: local ? 'ma-github-auth' : '__Host-ma-github-auth',
  };
}

function securityHeaders(response, nonce = '') {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
  );
}
function seal(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(value, key) {
  if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('GitHubログインを最初からやり直してください');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('invalid_cookie');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
  );
}
function cookie(config, value, age) {
  return `${config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.local ? '' : '; Secure'}`;
}
function same(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
function allowedOrigin(origin, config) {
  return (
    origin === APP_ORIGIN ||
    (config.local && ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin))
  );
}
function send(response, status, message, data = null, origin = null) {
  const nonce = randomBytes(16).toString('base64');
  securityHeaders(response, nonce);
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const json = (value) =>
    JSON.stringify(value)
      .replaceAll('<', '\\u003c')
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029');
  const script =
    data && origin
      ? `<script nonce="${nonce}">if(window.opener){window.opener.postMessage(${json(data)},${json(origin)});}</script>`
      : '';
  response.end(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>間 MA — GitHubログイン</title><style nonce="${nonce}">body{font:16px sans-serif;max-width:38em;margin:15vh auto;padding:20px;line-height:1.8;color:#365139;background:#fafbf6}</style><h1>GitHubログイン</h1><p>${escape(message)}</p><p>この画面を閉じてプランナーに戻れます。</p>${script}</html>`,
  );
}

export async function authorize(request, response, { env = process.env, now = Date.now } = {}) {
  securityHeaders(response);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return send(response, 405, 'この操作は利用できません');
  }
  try {
    const config = settings(env);
    const url = new URL(request.url, config.origin);
    const origin = url.searchParams.get('origin');
    const clientState = url.searchParams.get('state');
    if (!allowedOrigin(origin, config) || !/^[A-Za-z0-9_-]{43}$/.test(clientState || ''))
      return send(response, 400, '展覧会プランナーからログインを開始してください');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    response.setHeader(
      'Set-Cookie',
      cookie(
        config,
        seal(
          { state, verifier, origin, clientState, expiresAt: now() + STATE_LIFETIME },
          config.key,
        ),
        STATE_LIFETIME / 1000,
      ),
    );
    const location = new URL('https://github.com/login/oauth/authorize');
    location.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${config.origin}/api/callback`,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      allow_signup: 'false',
    }).toString();
    response.statusCode = 302;
    response.setHeader('Location', location.href);
    response.end();
  } catch {
    return send(
      response,
      503,
      'GitHubログインのサーバー設定が完了していません。管理者に確認してください',
    );
  }
}

export async function callback(
  request,
  response,
  { env = process.env, now = Date.now, fetcher = fetch } = {},
) {
  securityHeaders(response);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return send(response, 405, 'この操作は利用できません');
  }
  let config, flow;
  try {
    config = settings(env);
    response.setHeader('Set-Cookie', cookie(config, '', 0));
    const cookies = Object.fromEntries(
      String(request.headers.cookie || '')
        .split(';')
        .map((part) => {
          const index = part.indexOf('=');
          return [part.slice(0, index).trim(), part.slice(index + 1)];
        }),
    );
    flow = unseal(cookies[config.cookieName], config.key);
    const url = new URL(request.url, config.origin);
    if (
      !same(url.searchParams.get('state'), flow.state) ||
      flow.expiresAt <= now() ||
      !allowedOrigin(flow.origin, config)
    )
      throw new Error('invalid_state');
    if (url.searchParams.has('error'))
      return send(
        response,
        200,
        'GitHubログインを中止しました',
        { type: MESSAGE, state: flow.clientState, error: 'GitHubログインを中止しました' },
        flow.origin,
      );
    const code = url.searchParams.get('code');
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(code || '')) throw new Error('invalid_code');
    const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: `${config.origin}/api/callback`,
        code_verifier: flow.verifier,
        repository_id: String(REPOSITORY_ID),
      }),
    });
    if (!tokenResponse.ok) throw new Error('exchange_failed');
    const token = await tokenResponse.json();
    if (
      !/^ghu_[A-Za-z0-9_]+$/.test(token.access_token || '') ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0 ||
      token.expires_in > 28800
    )
      throw new Error('invalid_token');
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token.access_token}`,
    };
    const [userResponse, repoResponse] = await Promise.all([
      fetcher('https://api.github.com/user', { headers, signal: AbortSignal.timeout(15000) }),
      fetcher(`https://api.github.com/repos/${REPOSITORY}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      }),
    ]);
    if (!userResponse.ok || !repoResponse.ok) throw new Error('no_access');
    const user = await userResponse.json(),
      repository = await repoResponse.json();
    if (
      repository.id !== REPOSITORY_ID ||
      repository.permissions?.push !== true ||
      !/^[A-Za-z0-9-]{1,100}$/.test(user.login || '')
    )
      return send(
        response,
        403,
        'このリポジトリへの保存権限がありません',
        {
          type: MESSAGE,
          state: flow.clientState,
          error: 'このGitHubアカウントには保存権限がありません',
        },
        flow.origin,
      );
    return send(
      response,
      200,
      `${user.login} としてログインしました`,
      {
        type: MESSAGE,
        state: flow.clientState,
        token: token.access_token,
        login: user.login,
        expiresAt: now() + token.expires_in * 1000,
      },
      flow.origin,
    );
  } catch {
    if (config && flow && allowedOrigin(flow.origin, config))
      return send(
        response,
        400,
        'GitHubログインを確認できませんでした。もう一度お試しください',
        {
          type: MESSAGE,
          state: flow.clientState,
          error: 'GitHubログインを確認できませんでした。もう一度お試しください',
        },
        flow.origin,
      );
    return send(response, 400, 'GitHubログインを最初からやり直してください');
  }
}
