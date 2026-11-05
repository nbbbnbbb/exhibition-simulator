import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { storedProject, waitProject } from './placement-test-helpers.mjs';

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
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  return { ctx, page };
}
const open = (page) => page.getByRole('button', { name: 'クラウド保存', exact: true }).click();
const close = (page) => page.getByRole('button', { name: '閉じる', exact: true }).click();
const ready = (page) =>
  page.getByRole('button', { name: '作品リスト・保存', exact: true }).waitFor();
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
  await open(page);
  assert.equal(
    await page.getByRole('button', { name: '上書き保存', exact: true }).isDisabled(),
    true,
  );
  check('別名保存は別URLとなり、同一タブの共有URL変更で読込、JSON取込で以前の上書き先を解除');
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
