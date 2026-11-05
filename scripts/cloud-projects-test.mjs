import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const root = path.resolve('tmp/cloud-sign-in-test-build');
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', root], {
  env: { ...process.env, VITE_BASE_PATH: '/', VITE_GITHUB_AUTH_URL: 'https://auth.ma.test' },
  stdio: 'pipe',
});
const output = path.resolve('test-results/cloud-projects');
await fs.mkdir(output, { recursive: true });
const files = new Map();
let version = 0,
  denyLogin = false;
const token = 'ghu_fake_test_token_never_persist';
const errors = [];
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(name);
};
async function context() {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1080 },
    deviceScaleFactor: 0.75,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.route('http://127.0.0.1:5173/**', async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    try {
      await route.fulfill({
        body: await fs.readFile(file),
        contentType: types[path.extname(file)] || 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await ctx.route('https://api.github.com/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const endpoint = decodeURIComponent(url.pathname).replace(
      '/repos/nbbbnbbb/exhibition-simulator',
      '',
    );
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    };
    const reply = (data, status = 200) =>
      route.fulfill({
        status,
        headers,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    if (request.method() === 'OPTIONS') return reply({});
    const authorized = request.headers().authorization === `Bearer ${token}`;
    if (!endpoint)
      return reply({
        default_branch: 'main',
        private: false,
        permissions: { push: authorized },
      });
    if (endpoint.startsWith('/branches/')) return reply({ commit: { sha: `commit-${version}` } });
    if (endpoint === '/contents/ma-projects')
      return files.size
        ? reply([...files.values()].map(({ content, ...file }) => file))
        : reply({}, 404);
    if (endpoint.startsWith('/contents/ma-projects/')) {
      const filePath = endpoint.slice('/contents/'.length);
      if (request.method() === 'PUT') {
        assert.equal(authorized, true);
        const body = request.postDataJSON();
        const existing = files.get(filePath);
        if (existing && body.sha !== existing.sha) return reply({}, 409);
        version++;
        const file = {
          type: 'file',
          path: filePath,
          name: filePath.split('/').at(-1),
          sha: `blob-${version}`,
          content: body.content,
          encoding: 'base64',
          size: Buffer.from(body.content, 'base64').length,
        };
        files.set(filePath, file);
        return reply({ content: file }, existing ? 200 : 201);
      }
      return files.has(filePath) ? reply(files.get(filePath)) : reply({}, 404);
    }
    throw new Error(`Unexpected API request: ${request.method()} ${endpoint}`);
  });
  await ctx.route('https://auth.ma.test/api/authorize?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const data = {
      type: 'ma:github-sign-in',
      state: params.get('state'),
      ...(denyLogin
        ? { error: 'このGitHubアカウントには保存権限がありません' }
        : { token, login: 'nbbbnbbb', expiresAt: Date.now() + 3600000 }),
    };
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<script>window.opener.postMessage(${JSON.stringify(data)},${JSON.stringify(params.get('origin'))});</script>`,
    });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  return { ctx, page };
}
const open = (page) => page.getByRole('button', { name: 'クラウド保存', exact: true }).click();
const close = (page) =>
  page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).first().click();
const ready = (page) => page.locator('.save-status.saved').waitFor();
const visible = async (page, beams, mezzanine, rails) =>
  page.waitForFunction(
    ([a, b, c]) => {
      const data = document.querySelector('.scene-host')?.dataset;
      return (
        data?.showBeams === String(a) &&
        data?.showMezzanine === String(b) &&
        data?.showLightingRails === String(c)
      );
    },
    [beams, mezzanine, rails],
  );

try {
  const { page } = await context();
  await page.goto('http://127.0.0.1:5173/');
  await ready(page);
  await visible(page, true, true, true);
  const cardHeight = await page
    .locator('.art-card')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  await page.getByRole('button', { name: '一覧（画像なし）', exact: true }).click();
  assert.equal(await page.locator('.artwork-list img, .artwork-list .art-thumb').count(), 0);
  const compactHeight = await page
    .locator('.art-card')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(compactHeight < cardHeight * 0.6);
  assert.ok(await page.locator('.artwork-list .art-metadata').first().innerText());
  await page.getByRole('checkbox', { name: '梁', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '照明レール', exact: true }).uncheck();
  await visible(page, false, true, false);
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await visible(page, false, true, false);
  await page.getByRole('checkbox', { name: '中二階', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '梁', exact: true }).check();
  await visible(page, true, false, false);
  await waitProject(
    page,
    (p) =>
      p.displaySettings.beams === true &&
      p.displaySettings.mezzanine === false &&
      p.displaySettings.lightingRails === false &&
      p.displaySettings.artworkList === 'compact',
  );
  const lighting = (await storedProject(page)).layouts[0].lighting;
  await page.reload();
  await ready(page);
  await visible(page, true, false, false);
  assert.equal(
    await page
      .getByRole('button', { name: '一覧（画像なし）', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.deepEqual((await storedProject(page)).layouts[0].lighting, lighting);
  await page.screenshot({ path: path.join(output, 'compact-and-visibility.png') });
  check('画像なし一覧はカードより小さく、3種類の表示は独立して切替・ビュー変更・再読み込みで保持');

  const number = async (name, value) => {
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(String(value));
    await input.press('Enter');
  };
  await page.getByRole('button', { name: '表示項目', exact: true }).click();
  await page.getByRole('checkbox', { name: '作品情報ラベルを有効にする', exact: true }).check();
  await page.getByRole('checkbox', { name: '表示項目 制作年', exact: true }).uncheck();
  for (const [name, value] of [
    ['文字サイズ', 24],
    ['行間', 180],
    ['ラベルの横幅', 900],
    ['作品との余白', 160],
  ])
    await number(name, value);
  await page.screenshot({ path: path.join(output, 'label-style-options.png') });
  await close(page);
  await page.getByRole('checkbox', { name: '可動壁の床ライン', exact: true }).uncheck();
  await page.getByRole('button', { name: 'グリッド', exact: true }).click();
  await page.getByRole('button', { name: '寸法表示', exact: true }).click();
  await number('歩行時の目線高さ', 1850);
  await page.locator('.lighting-open-button').click();
  await page.getByRole('checkbox', { name: '俯瞰で天井を透視', exact: true }).uncheck();
  await page.getByLabel('日照の日付', { exact: true }).fill('2026-11-05');
  await number('スポット 基準照度', 375);
  await page.getByRole('button', { name: '配置の詳細', exact: true }).click();
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.getByLabel('鉄骨ラインの作業面', { exact: true }).selectOption('xy');
  await page.locator('.workplane-coordinates summary').click();
  await number('作業平面の中心 X', -300);
  await number('作業平面の中心 Y', 2500);
  await number('作業平面の中心 Z', 9000);
  await page.getByLabel('ラインの部材断面', { exact: true }).selectOption('u67');
  await page.getByRole('checkbox', { name: '鉄骨配置のスナップ', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '鉄骨ラインの直交モード', exact: true }).check();
  await page.getByRole('checkbox', { name: '鉄骨ラインを連続配置', exact: true }).uncheck();
  await page.getByRole('button', { name: /^作品 \d/ }).click();
  await page.getByRole('button', { name: '並べる', exact: true }).click();
  const label = page.locator('.plan-panel [data-artwork-label="p-1"]');
  await label.waitFor();
  assert.equal(await label.evaluate((el) => getComputedStyle(el).fontSize), '495px');
  const position = await label.evaluate((el) => ({
    x: Number(el.getAttribute('x')),
    y: el.getBBox().y + el.getBBox().height,
  }));
  assert.equal(position.x, 0);
  assert.ok(position.y < 6000 - 450, '平面図でもラベル全体を作品の上へ配置');
  await pointOnPlan(page, 105, 6000, true);
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.scene-host')?.dataset.artworkLabelCount === '4',
  );
  await page.screenshot({ path: path.join(output, 'labels-above-artwork.png') });
  await page.getByRole('button', { name: '表示項目', exact: true }).click();
  await page.getByLabel('作品情報の表示位置', { exact: true }).selectOption('overlay');
  await close(page);
  await page.getByRole('button', { name: '並べる', exact: true }).click();
  const overlayLabel = page.locator('.plan-panel [data-artwork-label="p-1"]');
  assert.equal(await overlayLabel.getAttribute('data-label-position'), 'overlay');
  const overlayPosition = await overlayLabel.evaluate((el) => ({
    x: Number(el.getAttribute('x')),
    y: el.getBBox().y + el.getBBox().height / 2,
  }));
  assert.equal(overlayPosition.x, 0);
  assert.ok(Math.abs(overlayPosition.y - 6000) < 150, '平面図の作品形状の中央へ情報を重ねる');
  await page.screenshot({ path: path.join(output, 'labels-overlay-plan.png') });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'labels-overlay-artwork.png') });
  await page.getByRole('button', { name: '左パネルを折り畳む', exact: true }).click();
  await page.getByRole('button', { name: '右パネルを折り畳む', exact: true }).click();
  const configured = await waitProject(
    page,
    (p) =>
      p.displaySettings.view === 'three' &&
      p.displaySettings.libraryPanel === false &&
      p.displaySettings.inspectorPanel === false &&
      p.steelLineSettings.orthogonal &&
      p.artworkLabels.fontSize === 24,
  );
  const settingsOf = (p) => ({
    labels: p.artworkLabels,
    display: p.displaySettings,
    steel: p.steelLineSettings,
    lighting: p.layouts[0].lighting,
  });
  const expectedSettings = settingsOf(configured);
  assert.equal(configured.artworkLabels.position, 'overlay');
  assert.equal(configured.displaySettings.eyeHeight, 1850);
  assert.equal(configured.displaySettings.floorLines, false);
  assert.equal(configured.displaySettings.grid, true);
  assert.equal(configured.displaySettings.dimensions, false);
  assert.equal(configured.displaySettings.cutawayRoof, false);
  assert.equal(configured.displaySettings.libraryPanel, false);
  assert.equal(configured.displaySettings.inspectorPanel, false);
  assert.deepEqual(configured.steelLineSettings.center, [-300, 2500, 9000]);
  await page.reload();
  await page.locator('.save-status.saved').waitFor();
  assert.deepEqual(settingsOf(await storedProject(page)), expectedSettings);
  assert.equal(await page.locator('#library-panel').isVisible(), false);
  assert.equal(await page.locator('#inspector-panel').isVisible(), false);
  assert.equal(
    await page.getByRole('button', { name: '3D', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.getByRole('checkbox', { name: '可動壁の床ライン', exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole('button', { name: 'グリッド', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: '表示項目', exact: true }).click();
  assert.equal(
    await page.getByLabel('作品情報の表示位置', { exact: true }).inputValue(),
    'overlay',
  );
  assert.equal(
    await page.getByRole('spinbutton', { name: '文字サイズ', exact: true }).inputValue(),
    '24',
  );
  await close(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  const exported = await downloading;
  const exportPath = path.join(output, 'settings.ma.json');
  await exported.saveAs(exportPath);
  assert.deepEqual(settingsOf(JSON.parse(await fs.readFile(exportPath, 'utf8'))), expectedSettings);
  check(
    '作品上部のラベル・文字設定・床ライン・グリッド・寸法・屋根・目線・ビュー・鉄骨の作業設定を自動保存とJSONへ保持',
  );

  await page.getByRole('textbox', { name: 'プロジェクト名', exact: true }).fill('共有する展覧会');
  await open(page);
  await page.getByText('保存はまだありません。', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('GitHubトークン', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('リポジトリ名', { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole('button', { name: '別名で保存', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'GitHubでログイン', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
  await page.getByRole('button', { name: '別名で保存', exact: true }).click();
  await page.getByText('別の保存として保存しました', { exact: true }).waitFor();
  await page.locator('.cloud-list[aria-busy="false"]').waitFor();
  assert.equal(files.size, 1);
  const url = page.url();
  assert.ok(url.includes('#github='));
  assert.ok(!url.includes(token));
  assert.equal(
    await page.getByRole('button', { name: '上書き保存', exact: true }).isEnabled(),
    true,
  );
  const filePath = [...files.keys()][0];
  const firstData = JSON.parse(Buffer.from(files.get(filePath).content, 'base64').toString('utf8'));
  assert.equal(firstData.name, '共有する展覧会');
  assert.equal(firstData.displaySettings.artworkList, 'compact');
  assert.deepEqual(settingsOf(firstData), expectedSettings);
  await page.getByRole('button', { name: 'URLをコピー', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(token));
  assert.ok(!JSON.stringify(await storedProject(page)).includes(token));
  await page.screenshot({ path: path.join(output, 'saved-list-and-url.png') });
  check('保存先固定・トークン入力なしのGitHubログイン・別名保存・一覧・URL・認証情報の非永続化');

  await close(page);
  await page.getByRole('textbox', { name: 'プロジェクト名', exact: true }).fill('上書きした展覧会');
  await open(page);
  await page.getByRole('button', { name: '上書き保存', exact: true }).click();
  await page.getByText('上書き保存しました', { exact: true }).waitFor();
  assert.equal(page.url(), url);
  assert.equal(files.size, 1);
  assert.equal(
    JSON.parse(Buffer.from(files.get(filePath).content, 'base64').toString('utf8')).name,
    '上書きした展覧会',
  );
  const shared = await context();
  await shared.page.goto(url);
  await ready(shared.page);
  assert.equal(
    await shared.page.getByRole('textbox', { name: 'プロジェクト名', exact: true }).inputValue(),
    '上書きした展覧会',
  );
  await visible(shared.page, true, false, false);
  assert.deepEqual(
    settingsOf(await waitProject(shared.page, (p) => p.name === '上書きした展覧会')),
    expectedSettings,
  );
  assert.equal(
    await shared.page.getByRole('checkbox', { name: '作品情報を表示', exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await shared.page.getByRole('button', { name: '3D', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await shared.page.locator('#library-panel').isVisible(), false);
  assert.equal(await shared.page.locator('#inspector-panel').isVisible(), false);
  assert.equal(await shared.page.locator('.artwork-list img').count(), 0);
  check('同じ共有URLは新しいブラウザーでも上書き後の状態と表示設定を自動復元');
  await shared.ctx.close();

  files.get(filePath).sha = 'changed-by-another-device';
  await page.getByRole('button', { name: '上書き保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '別の端末' }).waitFor();
  assert.equal(files.get(filePath).sha, 'changed-by-another-device');
  await close(page);
  await open(page);
  await page.getByRole('button', { name: '共有する展覧会を開く', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await open(page);
  await page.getByRole('button', { name: '上書き保存', exact: true }).click();
  await page.getByText('上書き保存しました', { exact: true }).waitFor();
  check('古いSHAでの上書きを拒否し、リストから開き直すと安全に保存できる');

  const reader = await context();
  await reader.page.goto(url);
  await ready(reader.page);
  await open(reader.page);
  await reader.page.getByRole('button', { name: '共有する展覧会を開く', exact: true }).waitFor();
  assert.equal(
    await reader.page.getByRole('button', { name: '上書き保存', exact: true }).isDisabled(),
    true,
  );
  denyLogin = true;
  await reader.page.getByRole('button', { name: 'GitHubでログイン', exact: true }).click();
  await reader.page.getByRole('alert').filter({ hasText: '保存権限' }).waitFor();
  assert.equal(
    await reader.page.getByRole('button', { name: '別名で保存', exact: true }).isDisabled(),
    true,
  );
  denyLogin = false;
  check('公開保存は未ログインでも読めるが、権限のないログインは拒否して保存を無効のまま保持');
  await reader.ctx.close();

  await close(page);
  await page.getByRole('textbox', { name: 'プロジェクト名', exact: true }).fill('別の展示');
  await open(page);
  await page.getByLabel('新しい保存名', { exact: true }).fill('別の保存');
  await page.getByRole('button', { name: '別名で保存', exact: true }).click();
  await page.getByText('別の保存として保存しました', { exact: true }).waitFor();
  assert.equal(files.size, 2);
  assert.notEqual(page.url(), url);
  await close(page);
  await page.evaluate((href) => {
    window.location.hash = new URL(href).hash;
  }, url);
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="プロジェクト名"]')?.value === '上書きした展覧会',
  );
  const imported = { ...firstData, name: 'ローカルJSONから読み込み' };
  await page.locator('.header-actions input[type="file"]').setInputFiles({
    name: 'local.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="プロジェクト名"]')?.value ===
      'ローカルJSONから読み込み',
  );
  assert.equal(new URL(page.url()).hash, '');
  assert.deepEqual(
    settingsOf(await waitProject(page, (p) => p.name === imported.name)),
    expectedSettings,
  );
  await open(page);
  assert.equal(
    await page.getByRole('button', { name: '上書き保存', exact: true }).isDisabled(),
    true,
  );
  check('別名保存は別URLとなり、同一タブの共有URL変更で読込、JSON取込で以前の上書き先を解除');

  await close(page);
  const beforeName = await page.getByLabel('プロジェクト名', { exact: true }).inputValue();
  await page.getByLabel('プロジェクト名', { exact: true }).fill('Undo確認');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  assert.equal(await page.getByLabel('プロジェクト名', { exact: true }).inputValue(), beforeName);
  assert.equal(
    await page.getByRole('button', { name: '平面', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: 'グリッド', exact: true }).click();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  assert.equal(await page.getByLabel('プロジェクト名', { exact: true }).inputValue(), 'Undo確認');
  assert.equal(
    await page.getByRole('button', { name: 'グリッド', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  check('ビュー・表示設定を変更しても、編集のUndo/Redoを消費せず設定を保持');

  const migration = await context();
  await migration.page.goto('http://127.0.0.1:5173/');
  await ready(migration.page);
  const legacy = structuredClone(firstData);
  legacy.name = '旧ローカル保存';
  for (const key of ['fontSize', 'lineHeight', 'width', 'gap', 'position'])
    delete legacy.artworkLabels[key];
  legacy.displaySettings = {
    beams: false,
    mezzanine: true,
    lightingRails: false,
    artworkList: 'compact',
  };
  delete legacy.steelLineSettings;
  await migration.page.evaluate(
    (data) =>
      new Promise((resolve, reject) => {
        localStorage.setItem('ma:show-floor-lines', 'false');
        localStorage.setItem(
          'ma:collapsed-panels',
          JSON.stringify({ library: true, inspector: true }),
        );
        const request = indexedDB.open('ma-exhibition-v1', 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').put(data, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    legacy,
  );
  await migration.page.reload();
  await ready(migration.page);
  const migrated = await storedProject(migration.page);
  assert.equal(migrated.displaySettings.floorLines, false);
  assert.equal(migrated.displaySettings.libraryPanel, false);
  assert.equal(migrated.displaySettings.inspectorPanel, false);
  assert.equal(migrated.artworkLabels.fontSize, 16);
  assert.equal(migrated.artworkLabels.position, 'above');
  assert.equal(migrated.steelLineSettings.snap, true);
  assert.equal(await migration.page.locator('#library-panel').isVisible(), false);
  legacy.name = '旧JSONを開く';
  await migration.page.locator('.header-actions input[type="file"]').setInputFiles({
    name: 'legacy.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  const importedLegacy = await waitProject(migration.page, (p) => p.name === legacy.name);
  assert.equal(importedLegacy.displaySettings.floorLines, true);
  assert.equal(importedLegacy.displaySettings.libraryPanel, true);
  assert.equal(importedLegacy.displaySettings.inspectorPanel, true);
  assert.equal(importedLegacy.displaySettings.beams, false);
  assert.equal(importedLegacy.artworkLabels.fontSize, 16);
  assert.deepEqual(importedLegacy.artworkLabels.fields, legacy.artworkLabels.fields);
  assert.equal(await migration.page.locator('#library-panel').isVisible(), true);
  await migration.ctx.close();
  check(
    '旧ローカル設定の床ライン・左右パネルを移行し、旧JSONには端末の設定を混ぜず不足項目だけ初期値を補う',
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ checks, errors, cardHeight, compactHeight }, null, 2),
  );
  console.log(`Passed ${checks.length} browser checks.`);
} catch (error) {
  const pages = browser.contexts().flatMap((ctx) => ctx.pages());
  const last = pages.at(-1);
  if (last) {
    console.error('Last page:', last.url(), await last.locator('body').innerText());
    await last.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
  console.error('Page errors:', errors);
  throw error;
} finally {
  await browser.close();
}
