import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createProject } from '../src/domain.js';
import { placeOnPlan } from './placement-test-helpers.mjs';
import {
  suppliedArtworks,
  legacySuppliedArtworks,
  SUPPLIED_CATALOG,
  catalogJSON,
} from '../src/catalog.js';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
const output = path.resolve('test-results/catalog');
await fs.mkdir(output, { recursive: true });
const openList = () => page.getByRole('button', { name: '作品リスト・保存', exact: true }).click();
const close = () => page.getByRole('button', { name: '閉じる', exact: true }).click();
const saveDownload = async (button, filename) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await pending;
  const target = path.join(output, filename);
  await download.saveAs(target);
  return fs.readFile(target, 'utf8');
};
const stored = () =>
  page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ma-exhibition-v1', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve) => {
        const req = db.transaction('projects').objectStore('projects').get('current');
        req.onsuccess = () => resolve(req.result);
      });
    } finally {
      db.close();
    }
  });
const waitSaved = async (predicate) => {
  for (let i = 0; i < 80; i++) {
    if (predicate(await stored())) return;
    await page.waitForTimeout(100);
  }
  throw new Error('IndexedDB did not reach the expected state');
};

try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '作品リスト・保存' }).waitFor();
  await waitSaved((p) => p?.artworks.length === 20);
  // Simulate a real previous project, then verify additive startup migration.
  const legacy = createProject();
  legacy.artworks = [...legacy.artworks.slice(0, 4), ...legacySuppliedArtworks()];
  legacy.artworks[0].artist = '既存ユーザーの作家名';
  legacy.layouts[0].placements[0].s = 6500;
  legacy.appliedCatalogs = [SUPPLIED_CATALOG];
  await page.evaluate(async (project) => {
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('ma-exhibition-v1', 1);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(project, 'current');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, legacy);
  await page.reload({ waitUntil: 'networkidle' });
  await waitSaved((p) => p?.artworks.length === 20 && p.appliedCatalogs?.length === 2);
  let saved = await stored();
  assert.equal(saved.artworks[0].artist, '既存ユーザーの作家名');
  assert.equal(saved.layouts[0].placements[0].s, 6500);
  await openList();
  assert.equal(await page.locator('.catalog-table tbody tr').count(), 20);
  const csv = await saveDownload('作品リストCSVを保存', '作品リスト.csv');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'@KCUA"'));
  assert.ok(csv.includes('"3列×2段 / 間隔なし 4800×2360 mm"'));
  assert.ok(csv.includes('1350×900×未定 mm / 2梱包'));
  assert.ok(csv.includes('色々（0号程度から20号程度）'));
  const json = JSON.parse(
    await saveDownload('作品リストJSONを保存', '作品リスト.ma-artworks.json'),
  );
  assert.deepEqual(json.artworks.slice(4), suppliedArtworks());
  await page.screenshot({ path: path.join(output, 'list-desktop.png'), fullPage: true });
  await close();

  // Unknown dimensions and unsupported display modes cannot be wall-mounted.
  assert.equal(
    await page.getByRole('button', { name: '花の連作5点を配置', exact: true }).isDisabled(),
    false,
  );
  assert.equal(
    await page.getByRole('button', { name: '出す作品たちを配置', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: '四曲屏風を配置', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: '花の連作5点を編集', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: '制作年', exact: true }).inputValue(),
    '2024-2025',
  );
  assert.equal(await page.getByRole('spinbutton', { name: '幅', exact: true }).inputValue(), '455');
  assert.equal(
    await page.getByRole('combobox', { name: '寸法の確度', exact: true }).inputValue(),
    'provisional',
  );
  await page
    .getByRole('textbox', { name: '備考', exact: true })
    .fill('出したい\n"テスト用採寸", 確認済み');
  for (const [label, value] of [
    ['幅', '800'],
    ['高さ', '600'],
  ]) {
    const field = page.getByRole('spinbutton', { name: label, exact: true });
    await field.fill(value);
    await field.press('Tab');
  }
  await page.screenshot({ path: path.join(output, 'edit-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '花の連作5点を配置', exact: true }).isEnabled(),
    true,
  );
  // No image is necessary for registration, rendering, persistence or export.
  await page.getByRole('button', { name: '作品を登録', exact: true }).click();
  await page.getByRole('textbox', { name: '作品名', exact: true }).fill('画像なし作品');
  await page.getByRole('textbox', { name: '作者', exact: true }).fill('検証作家');
  await page.getByRole('textbox', { name: '制作年', exact: true }).fill('2026');
  await page.getByRole('textbox', { name: '属性', exact: true }).fill('@KCUA');
  await page.getByRole('button', { name: '梱包を追加', exact: true }).click();
  for (const [label, value] of [
    ['梱包1 幅', '1000'],
    ['梱包1 高さ', '500'],
    ['梱包1 奥行', '80'],
    ['梱包1 数量', '1'],
  ]) {
    const field = page.getByRole('spinbutton', { name: label, exact: true });
    await field.fill(value);
    await field.press('Tab');
  }
  for (const [label, value] of [
    ['幅', '1000'],
    ['高さ', '500'],
    ['数量（配置上限）', '2'],
  ]) {
    const field = page.getByRole('spinbutton', { name: label, exact: true });
    await field.fill(value);
    await field.press('Tab');
  }
  assert.equal(
    await page.getByRole('spinbutton', { name: '厚み', exact: true }).inputValue(),
    '40',
  );
  await page.getByRole('button', { name: 'ライブラリに登録', exact: true }).click();
  await placeOnPlan(page, '画像なし作品', 50, 15000);
  await placeOnPlan(page, '画像なし作品', 50, 17000);
  await waitSaved((p) => p?.layouts[0].placements.length === 6);
  saved = await stored();
  assert.equal(saved.artworks.at(-1).image, '');
  assert.equal(saved.artworks.at(-1).depth, 40);
  assert.equal(saved.artworks.at(-1).packages[0].width, 1000);
  assert.equal(saved.artworks.at(-1).packages[0].quantity, 1);
  await page.screenshot({ path: path.join(output, 'no-image-placement.png'), fullPage: true });
  await openList();
  const changed = { ...saved.artworks[4], notes: 'JSONからの更新' };
  await page.getByLabel('作品リストJSONファイル', { exact: true }).setInputFiles({
    name: 'update.json',
    mimeType: 'application/json',
    buffer: Buffer.from(catalogJSON([changed])),
  });
  await waitSaved((p) => p?.artworks[4].notes === 'JSONからの更新');
  assert.deepEqual((await stored()).layouts, saved.layouts);
  await page.getByLabel('作品リストJSONファイル', { exact: true }).setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(catalogJSON([{ ...changed, quantity: -1 }])),
  });
  await page.getByRole('alert').filter({ hasText: '取り込み失敗' }).waitFor();
  assert.equal((await stored()).artworks[4].notes, 'JSONからの更新');
  await close();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitSaved((p) => p?.artworks[4].notes === saved.artworks[4].notes);
  // A deleted supplied item stays deleted after reload.
  await page.getByRole('button', { name: '小さいもの（20×30cm）を編集', exact: true }).click();
  await page.getByRole('button', { name: '作品を削除', exact: true }).click();
  await page.getByRole('button', { name: '全プランから作品を削除する', exact: true }).click();
  await waitSaved((p) => p?.artworks.length === 20);
  await page.reload({ waitUntil: 'networkidle' });
  await openList();
  assert.equal(await page.locator('.catalog-table tbody tr').count(), 20);
  assert.equal(
    await page.getByRole('cell', { name: '小さいもの（20×30cm）', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('cell', { name: '小さいもの（30×40cm）', exact: true }).count(),
    1,
  );
  await close();
  const projectJSON = JSON.parse(await saveDownload('書き出す', 'project.ma.json'));
  assert.equal(projectJSON.artworks.find((a) => a.title === '画像なし作品').depth, 40);
  await openList();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'list-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = {
    status: 'passed',
    checks: [
      'legacy migration',
      '14 source rows interpreted as 16 entries',
      'Mitsuhashi mixed group unchanged',
      'numeric packing dimensions and quantities',
      'assembly dimensions and provisional sizes',
      'CSV download',
      'JSON download',
      'metadata edit',
      'unknown dimensions',
      'freestanding classification',
      'image-free registration and 3D placement',
      'multiple panels',
      'JSON merge',
      'invalid import protection',
      'undo',
      'deletion persists',
      'project export',
      'mobile overflow',
    ],
    browserErrors: errors,
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
