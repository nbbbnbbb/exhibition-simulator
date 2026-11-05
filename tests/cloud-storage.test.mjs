import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/domain.js';
import { DEFAULT_DISPLAY_SETTINGS } from '../src/displaySettings.js';
import { DEFAULT_STEEL_LINE_SETTINGS } from '../src/steelLinePlacement.js';
import {
  cloudConfig,
  cloudURL,
  parseCloudURL,
  connectGitHub,
  listCloudProjects,
  readCloudProject,
  writeCloudProject,
  MAX_CLOUD_BYTES,
  DEFAULT_CLOUD_CONFIG,
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
  assert.deepEqual(p.displaySettings, DEFAULT_DISPLAY_SETTINGS);
  p.displaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    beams: false,
    mezzanine: true,
    lightingRails: false,
    artworkList: 'compact',
    floorLines: false,
    grid: true,
    dimensions: false,
    cutawayRoof: false,
    view: 'three',
    eyeHeight: 1800,
  };
  assert.deepEqual(
    validateProject(JSON.parse(JSON.stringify(p))).displaySettings,
    p.displaySettings,
  );
  p.displaySettings.beams = 'false';
  assert.throws(() => validateProject(p), /表示設定/);
});

test('旧データの作業設定を移行し、表示・鉄骨の全設定を独立して保存する', () => {
  const p = createProject();
  delete p.steelLineSettings;
  p.displaySettings = { beams: false, artworkList: 'compact' };
  validateProject(p);
  assert.deepEqual(p.displaySettings, {
    ...DEFAULT_DISPLAY_SETTINGS,
    beams: false,
    artworkList: 'compact',
  });
  assert.deepEqual(p.steelLineSettings, DEFAULT_STEEL_LINE_SETTINGS);
  p.steelLineSettings = {
    plane: 'xy',
    offset: -200,
    center: [1000, 2000, -200],
    sectionId: 'c65',
    continuous: false,
    snap: false,
    orthogonal: true,
  };
  const next = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(next, p);
  next.steelLineSettings.center[0] = 999;
  assert.equal(p.steelLineSettings.center[0], 1000);
  for (const [group, key, value] of [
    ['displaySettings', 'floorLines', 'false'],
    ['displaySettings', 'grid', 1],
    ['displaySettings', 'dimensions', null],
    ['displaySettings', 'cutawayRoof', 0],
    ['displaySettings', 'view', 'invalid'],
    ['displaySettings', 'eyeHeight', 799],
    ['steelLineSettings', 'plane', 'invalid'],
    ['steelLineSettings', 'center', [0, 1]],
    ['steelLineSettings', 'offset', 0.5],
    ['steelLineSettings', 'snap', 'false'],
    ['steelLineSettings', 'sectionId', 'missing'],
  ]) {
    const invalid = structuredClone(p);
    invalid[group][key] = value;
    assert.throws(() => validateProject(invalid), /設定/);
  }
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
  Object.assign(project.artworkLabels, {
    enabled: true,
    fontSize: 24,
    lineHeight: 180,
    width: 900,
    gap: 200,
  });
  Object.assign(project.displaySettings, {
    floorLines: false,
    grid: true,
    dimensions: false,
    cutawayRoof: false,
    eyeHeight: 1900,
  });
  Object.assign(project.steelLineSettings, { snap: false, orthogonal: true });
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
  assert.deepEqual(result.project, project);
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
  const config = DEFAULT_CLOUD_CONFIG;
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
  await assert.rejects(writeCloudProject(config, '', project, 'name'), /ログイン/);
  await assert.rejects(
    writeCloudProject({ ...config, repo: 'other' }, 'test-token', project, 'name', file),
    /固定されています/,
  );
});

test('アクセス拒否・ネットワーク障害・大きすぎる保存を明示し、壊れたプロジェクトを拒否する', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({}, 401));
  await assert.rejects(connectGitHub(config, 'bad'), /ログインの有効期限/);
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
