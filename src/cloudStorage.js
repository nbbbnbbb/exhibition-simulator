import { validateProject } from './domain.js';

export const CLOUD_FOLDER = 'ma-projects';
export const DEFAULT_CLOUD_CONFIG = Object.freeze({
  owner: 'nbbbnbbb',
  repo: 'exhibition-simulator',
  branch: 'ma-saves',
});
export const MAX_CLOUD_BYTES = 80 * 1024 * 1024;
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function cloudConfig(value) {
  const owner = String(value.owner || '').trim();
  const repo = String(value.repo || '').trim();
  const branch = String(value.branch || '').trim();
  if (
    !/^[a-zA-Z0-9-]{1,100}$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) ||
    ['.', '..'].includes(repo)
  )
    throw new Error('GitHubの所有者とリポジトリ名を入力してください');
  if (branch.length > 200 || /[\x00-\x20?#]/.test(branch)) throw new Error('ブランチ名が不正です');
  return { owner, repo, branch };
}

function filePath(path) {
  if (
    typeof path !== 'string' ||
    !path.startsWith(`${CLOUD_FOLDER}/`) ||
    path.split('/').length !== 2 ||
    !path.endsWith('.ma.json') ||
    /[\x00-\x1f\\]/.test(path) ||
    path.length > 250
  )
    throw new Error('MAの保存ファイルの場所が不正です');
  return path.split('/').map(encodeURIComponent).join('/');
}

async function request(config, token, endpoint = '', options = {}) {
  const { owner, repo } = cloudConfig(config);
  let response;
  try {
    response = await fetch(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${endpoint}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
        ...options,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      },
    );
  } catch {
    throw new Error('GitHubに接続できません。通信状態を確認して再試行してください');
  }
  if (!response.ok) {
    const messages = {
      401: 'GitHubログインの有効期限が切れました。再度ログインしてください',
      403: 'GitHubの権限またはAPI利用制限により実行できません。アカウントの保存権限と利用状況を確認してください',
      404: '保存先が見つかりません。リポジトリ・ブランチ・ファイル名とアクセス権を確認してください',
      409: '別の端末などで保存先が更新されています。一覧から開き直すか、別名で保存してください',
      422: '保存できませんでした。ブランチの保護設定・書き込み権限・ファイルの競合を確認してください',
      429: 'GitHubのAPI利用制限に達しました。時間をおいて再試行してください',
    };
    throw new GitHubError(
      response.status,
      messages[response.status] || `GitHubでエラーが発生しました（${response.status}）`,
    );
  }
  return response;
}

async function revision(config, token) {
  if (!config.branch) throw new Error('保存先のブランチを指定してください');
  return (
    await (await request(config, token, `/branches/${encodeURIComponent(config.branch)}`)).json()
  ).commit.sha;
}

export async function connectGitHub(value, token) {
  const config = cloudConfig(value);
  const repository = await (await request(config, token)).json();
  config.branch ||= repository.default_branch;
  await revision(config, token);
  return {
    config,
    private: repository.private,
    canWrite: !!token && repository.permissions?.push !== false,
  };
}

function entry(file) {
  const parts = file.name.slice(0, -8).split('--');
  const timestamp = Number(parts[0]);
  return {
    path: file.path,
    sha: file.sha,
    size: file.size,
    name: parts.length >= 3 ? parts.slice(2).join('--') : file.name.slice(0, -8),
    createdAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
  };
}

export async function listCloudProjects(config, token) {
  const ref = await revision(config, token);
  let files;
  try {
    files = await (
      await request(config, token, `/contents/${CLOUD_FOLDER}?ref=${encodeURIComponent(ref)}`)
    ).json();
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
  if (!Array.isArray(files)) throw new Error(`${CLOUD_FOLDER}はフォルダーである必要があります`);
  if (files.length >= 1000)
    throw new Error(
      '保存フォルダーの一覧上限（1,000件）に達しました。別の保存用リポジトリを指定してください',
    );
  return files
    .filter((f) => f.type === 'file' && f.name.endsWith('.ma.json'))
    .map(entry)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.name.localeCompare(b.name, 'ja'));
}

function encodeContent(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export async function readCloudProject(config, token, path) {
  const encoded = filePath(path);
  const ref = await revision(config, token);
  const endpoint = `/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
  const metadata = await (
    await request(config, token, endpoint, {
      headers: { Accept: 'application/vnd.github.object+json' },
    })
  ).json();
  if (metadata.type !== 'file' || !metadata.sha) throw new Error('保存ファイルを読み込めません');
  if (metadata.size > MAX_CLOUD_BYTES) throw new Error('保存データは80 MB以内にしてください');
  let text;
  if (metadata.encoding === 'base64') {
    const binary = atob(metadata.content.replace(/\s/g, ''));
    text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } else {
    text = await (
      await request(config, token, endpoint, {
        headers: { Accept: 'application/vnd.github.raw+json' },
      })
    ).text();
  }
  if (new TextEncoder().encode(text).length > MAX_CLOUD_BYTES)
    throw new Error('保存データは80 MB以内にしてください');
  const project = validateProject(JSON.parse(text));
  return { project, file: { ...entry({ ...metadata, path }), config: cloudConfig(config) } };
}

export async function writeCloudProject(config, token, project, name, target = null) {
  if (!token) throw new Error('保存するにはGitHubにログインしてください');
  if (JSON.stringify(cloudConfig(config)) !== JSON.stringify(DEFAULT_CLOUD_CONFIG))
    throw new Error(
      '保存先はこのアプリの保存専用ブランチに固定されています。別名で保存してください',
    );
  if (!config.branch) throw new Error('保存先のブランチを指定してください');
  validateProject(structuredClone(project));
  const safeName = [
    ...String(name)
      .trim()
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_'),
  ]
    .slice(0, 40)
    .join('');
  if (!safeName) throw new Error('保存名を入力してください');
  if (
    target &&
    (!target.sha ||
      JSON.stringify(cloudConfig(target.config)) !== JSON.stringify(cloudConfig(config)))
  )
    throw new Error('読み込んだ保存先と接続先が異なります。別名で保存してください');
  const path =
    target?.path || `${CLOUD_FOLDER}/${Date.now()}--${crypto.randomUUID()}--${safeName}.ma.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(project));
  if (bytes.length > MAX_CLOUD_BYTES)
    throw new Error(
      '画像を含む保存データは80 MB以内にしてください。画像を減らして再試行してください',
    );
  const result = await (
    await request(config, token, `/contents/${filePath(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${target ? 'Update' : 'Save'} MA project: ${safeName}`,
        content: encodeContent(bytes),
        branch: config.branch,
        ...(target ? { sha: target.sha } : {}),
      }),
    })
  ).json();
  return { ...entry(result.content), config: cloudConfig(config) };
}

export function cloudURL(config, path, href = window.location.href) {
  const value = cloudConfig(config);
  filePath(path);
  const url = new URL(href);
  url.hash = new URLSearchParams({
    github: `${value.owner}/${value.repo}`,
    branch: value.branch,
    file: path,
  }).toString();
  return url.href;
}

export function parseCloudURL(href) {
  const params = new URLSearchParams(new URL(href).hash.slice(1));
  if (!params.has('github')) return null;
  const repository = params.get('github').split('/');
  if (repository.length !== 2) throw new Error('保存URLのリポジトリ指定が不正です');
  const config = cloudConfig({
    owner: repository[0],
    repo: repository[1],
    branch: params.get('branch'),
  });
  const path = params.get('file');
  if (!config.branch) throw new Error('保存URLにブランチ名がありません');
  filePath(path);
  return { config, path };
}
