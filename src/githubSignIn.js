export const GITHUB_AUTH_URL = import.meta.env?.VITE_GITHUB_AUTH_URL || '';
export const GITHUB_SIGN_IN_MESSAGE = 'ma:github-sign-in';

export function authServiceURL(value) {
  if (!value) throw new Error('GitHubログインの接続先を管理者が設定する必要があります');
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('GitHubログインの接続先が不正です');
  return url;
}

export function validSignInMessage(event, { popup, origin, state, now = Date.now() }) {
  const data = event.data;
  return (
    event.source === popup &&
    event.origin === origin &&
    data?.type === GITHUB_SIGN_IN_MESSAGE &&
    data.state === state &&
    typeof data.token === 'string' &&
    /^ghu_[A-Za-z0-9_]+$/.test(data.token) &&
    typeof data.login === 'string' &&
    /^[A-Za-z0-9-]{1,100}$/.test(data.login) &&
    Number.isFinite(data.expiresAt) &&
    data.expiresAt > now &&
    data.expiresAt <= now + 8 * 60 * 60 * 1000 + 60000
  );
}

export function signInToGitHub({ serviceURL = GITHUB_AUTH_URL, browser = window } = {}) {
  const service = authServiceURL(serviceURL);
  const bytes = browser.crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const url = new URL('/api/authorize', service);
  url.search = new URLSearchParams({ origin: browser.location.origin, state }).toString();
  const popup = browser.open(url.href, '_blank', 'popup,width=600,height=760');
  if (!popup) throw new Error('GitHubログインのポップアップを許可してください');
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      browser.removeEventListener('message', receive);
      browser.removeEventListener('pagehide', leave);
      browser.clearInterval(closed);
      browser.clearTimeout(timeout);
      popup.close();
      if (error) reject(error);
      else resolve(value);
    };
    const receive = (event) => {
      if (
        event.source !== popup ||
        event.origin !== service.origin ||
        event.data?.state !== state ||
        event.data?.type !== GITHUB_SIGN_IN_MESSAGE
      )
        return;
      if (typeof event.data.error === 'string') {
        finish(new Error(event.data.error));
      } else if (validSignInMessage(event, { popup, origin: service.origin, state })) {
        finish(null, {
          token: event.data.token,
          login: event.data.login,
          expiresAt: event.data.expiresAt,
        });
      } else finish(new Error('GitHubログインの応答を確認できません。再度ログインしてください'));
    };
    const leave = () => finish(new Error('GitHubログインを中止しました'));
    const closed = browser.setInterval(() => {
      if (popup.closed) leave();
    }, 1000);
    const timeout = browser.setTimeout(
      () => finish(new Error('GitHubログインの時間が切れました。再度ログインしてください')),
      10 * 60 * 1000,
    );
    browser.addEventListener('message', receive);
    browser.addEventListener('pagehide', leave);
  });
}
