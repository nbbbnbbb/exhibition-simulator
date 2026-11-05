import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/domain.js';
import {
  cloudConfig,
  cloudURL,
  parseCloudURL,
  connectGitHub,
  listCloudProjects,
  readCloudProject,
  writeCloudProject,
  MAX_CLOUD_BYTES,
} from '../src/cloudStorage.js';

const config = { owner: 'gallery', repo: 'exhibitions', branch: 'saves/main' };
const path = 'ma-projects/1793850000000--uuid--展覧会.ma.json';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const branch = () => json({ commit: { sha: 'commit-snapshot' } });

test('共有URLは保存先を復元でき、トークンを含まずサブパスを保持する', () => {
  const url = cloudURL(
    { ...config, token: 'secret' },
    path,
    'https://gallery.github.io/simulator/',
  );
  assert.deepEqual(parseCloudURL(url), { config, path });
  assert.equal(new URL(url).pathname, '/simulator/');
  assert.ok(!url.includes('secret'));
  assert.equal(parseCloudURL('https://example.test/'), null);
  assert.throws(() => cloudConfig({ owner: '../evil', repo: 'repo' }));
  assert.throws(() => cloudURL(config, 'ma-projects/../README.md', 'https://example.test'));
  assert.throws(() => parseCloudURL('https://example.test/#github=a/b/c&file=README.md'));
});

test('旧プロジェクトに表示設定を補い、独立したON/OFFと一覧モードをJSONで保持する', () => {
  const p = createProject();
  delete p.displaySettings;
  validateProject(p);
  assert.deepEqual(p.displaySettings, {
    beams: true,
    mezzanine: true,
    lightingRails: true,
    artworkList: 'cards',
  });
  p.displaySettings = {
    beams: false,
    mezzanine: true,
    lightingRails: false,
    artworkList: 'compact',
  };
  assert.deepEqual(
    validateProject(JSON.parse(JSON.stringify(p))).displaySettings,
    p.displaySettings,
  );
  p.displaySettings.beams = 'false';
  assert.throws(() => validateProject(p), /表示設定/);
});

test('既定ブランチで接続し、保存フォルダーがない場合は空の一覧を返す', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/exhibitions'))
      return json({ default_branch: 'main', private: true, permissions: { push: true } });
    if (url.includes('/branches/')) return branch();
    return json({}, 404);
  });
  const connection = await connectGitHub({ ...config, branch: '' }, 'test-token');
  assert.equal(connection.config.branch, 'main');
  assert.equal(connection.private, true);
  assert.deepEqual(await listCloudProjects(connection.config, 'test-token'), []);
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer test-token'));
  assert.ok(calls.at(-1).url.includes('ref=commit-snapshot'));
});

test('保存リストはMAファイルだけを新しい順に表示する', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) =>
    url.includes('/branches/')
      ? branch()
      : json([
          { type: 'file', name: '1793850000000--id--最初.ma.json', path: 'first', size: 100 },
          { type: 'file', name: 'README.md', path: 'readme' },
          { type: 'dir', name: 'folder.ma.json', path: 'folder' },
          { type: 'file', name: '1793850001000--id--次の保存.ma.json', path: 'next', size: 200 },
        ]),
  );
  const list = await listCloudProjects(config, '');
  assert.deepEqual(
    list.map((f) => f.name),
    ['次の保存', '最初'],
  );
});

test('Unicodeと画像を含む保存を読み込み、1 MB超のファイルは同じコミットのrawデータを使う', async (t) => {
  const project = createProject();
  project.name = '日本語の展覧会';
  const contents = JSON.stringify(project);
  const calls = [];
  let large = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/branches/')) return branch();
    if (options.headers.Accept === 'application/vnd.github.raw+json') return new Response(contents);
    assert.equal(options.headers.Accept, 'application/vnd.github.object+json');
    return json({
      type: 'file',
      name: path.split('/').at(-1),
      sha: 'blob-original',
      size: large ? 2000000 : contents.length,
      encoding: large ? 'none' : 'base64',
      content: large ? '' : Buffer.from(contents).toString('base64'),
    });
  });
  let result = await readCloudProject(config, '', path);
  assert.equal(result.project.name, project.name);
  assert.equal(result.project.artworks[0].image, project.artworks[0].image);
  assert.equal(result.file.sha, 'blob-original');
  large = true;
  result = await readCloudProject(config, '', path);
  assert.equal(result.project.name, project.name);
  assert.ok(
    calls
      .filter((c) => c.url.includes('/contents/'))
      .every((c) => c.url.includes('ref=commit-snapshot')),
  );
});

test('別名保存は新規ファイル、上書きは読み込み時のSHAを送り競合を拒否する', async (t) => {
  const project = createProject();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.sha === 'stale') return json({}, 409);
    const actualPath = decodeURIComponent(new URL(url).pathname.split('/contents/')[1]);
    return json(
      {
        content: {
          type: 'file',
          path: actualPath,
          name: actualPath.split('/').at(-1),
          sha: 'new-sha',
          size: 100,
        },
      },
      201,
    );
  });
  const file = await writeCloudProject(config, 'test-token', project, '展覧会の案');
  assert.equal(file.name, '展覧会の案');
  assert.equal(calls[0].sha, undefined);
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].content, 'base64').toString('utf8')), project);
  const updated = await writeCloudProject(config, 'test-token', project, file.name, file);
  assert.equal(updated.path, file.path);
  assert.equal(calls[1].sha, 'new-sha');
  await assert.rejects(
    writeCloudProject(config, 'test-token', project, file.name, { ...file, sha: 'stale' }),
    /更新されています/,
  );
  await assert.rejects(writeCloudProject(config, '', project, 'name'), /トークン/);
  await assert.rejects(
    writeCloudProject({ ...config, repo: 'other' }, 'test-token', project, 'name', file),
    /接続先が異なります/,
  );
});

test('アクセス拒否・ネットワーク障害・大きすぎる保存を明示し、壊れたプロジェクトを拒否する', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({}, 401));
  await assert.rejects(connectGitHub(config, 'bad'), /トークンが無効/);
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await assert.rejects(connectGitHub(config, ''), /通信状態/);
  globalThis.fetch = async (url) =>
    url.includes('/branches/')
      ? branch()
      : json({ type: 'file', sha: 'blob', size: MAX_CLOUD_BYTES + 1 });
  await assert.rejects(readCloudProject(config, '', path), /80 MB/);
  globalThis.fetch = async (url) =>
    url.includes('/branches/')
      ? branch()
      : json({ type: 'file', sha: 'blob', size: 2, encoding: 'base64', content: 'e30=' });
  await assert.rejects(readCloudProject(config, '', path), /対応するMA/);
});
