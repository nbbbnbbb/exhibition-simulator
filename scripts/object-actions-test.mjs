import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject, walls, positionOnWall, partitionGeometry } from '../src/domain.js';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(45000);
const root = path.resolve('dist'),
  output = 'test-results/object-actions',
  errors = [],
  checks = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (e) => errors.push(e.message));
if (!process.env.MA_TEST_URL)
  await page.route('http://127.0.0.1:5173/**', async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname),
      file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
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
const seed = createProject();
seed.name = '右クリックと行列追加の検証';
Object.assign(seed.artworks[0], {
  quantity: 8,
  width: 600,
  height: 700,
  notes: '作品情報に表示する備考',
});
seed.layouts[0].partitions = [
  {
    id: 'part',
    name: '検証用可動壁',
    railId: 'rail-cross-3',
    s: 4500,
    width: 3000,
    height: 5000,
    thickness: 200,
  },
];
seed.layouts[0].placements = [
  { id: 'p-1', artworkId: 'art-1', wallId: 'west', s: 4000, bottom: 900 },
  { id: 'p-child', artworkId: 'art-2', wallId: 'partition:part:front', s: 1500, bottom: 1000 },
];
const layout = (p) => p.layouts.find((l) => l.id === p.activeLayoutId),
  title = seed.artworks[0].title,
  original = () => page.locator('.plan-panel .plan-art[data-placement-id="p-1"]'),
  menu = () => page.getByRole('menu'),
  undo = () => page.getByRole('button', { name: '元に戻す', exact: true }).click();
const check = (message) => {
  checks.push(message);
  console.log(message);
};
async function beginBatch() {
  await page.getByRole('button', { name: `${title}をまとめて配置`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '作品をまとめて配置', exact: true });
  for (const [name, value] of [
    ['追加する点数', 4],
    ['列数', 2],
    ['横の間隔', 100],
    ['縦の間隔', 150],
  ])
    await dialog.getByRole('spinbutton', { name, exact: true }).fill(String(value));
  await dialog.getByRole('button', { name: '行列のプレビューを開始', exact: true }).click();
  await page.locator('.placement-banner').waitFor();
}
async function at3D(camera, point, button) {
  const box = await page.locator('canvas').boundingBox();
  camera.aspect = box.width / box.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...point.map((n) => n / 1000)).project(camera);
  const x = box.x + ((v.x + 1) * box.width) / 2,
    y = box.y + ((1 - v.y) * box.height) / 2;
  assert.ok(
    x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height,
    '3D target must be visible',
  );
  await page.mouse.move(x, y);
  if (button) await page.mouse.click(x, y, { button });
}
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  await waitProject(page, (p) => !!p.rails);
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'objects.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await waitProject(page, (p) => p.name === seed.name);
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await original().click({ button: 'right' });
  await menu().waitFor();
  assert.match(await menu().innerText(), /600 × 700/);
  await page.screenshot({ path: `${output}/plan-menu.png`, fullPage: true });
  await menu().getByRole('menuitem', { name: '作品情報を表示', exact: true }).click();
  let info = page.getByRole('dialog', { name: '作品情報', exact: true });
  await info.waitFor();
  assert.match(await info.innerText(), /作品情報に表示する備考/);
  await info.getByRole('button', { name: '閉じる', exact: true }).first().click();
  await original().click({ button: 'right' });
  await menu().getByRole('menuitem', { name: '作品の配置を削除', exact: true }).click();
  let saved = await waitProject(page, (p) => layout(p).placements.length === 1);
  assert.deepEqual(
    saved.artworks,
    seed.artworks,
    'removing a placement must retain catalog metadata',
  );
  await undo();
  await waitProject(page, (p) => layout(p).placements.some((p) => p.id === 'p-1'));
  await original().click({ button: 'right' });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').innerText(), '作品の配置を削除');
  await page.keyboard.press('Escape');
  await menu().waitFor({ state: 'hidden' });
  check(
    'plan: artwork right-click menu, full metadata, placement-only deletion, one-step Undo, keyboard dismissal',
  );

  await page.getByRole('button', { name: `${title}をまとめて配置`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert.equal(await page.locator('.placement-banner').count(), 0);
  await beginBatch();
  await pointOnPlan(page, 50, 4000, true);
  assert.equal(await page.locator('.scene-host').getAttribute('data-preview-valid'), 'false');
  assert.equal(layout(await storedProject(page)).placements.length, 2);
  await pointOnPlan(page, 50, 16000);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewValid === 'true',
  );
  assert.equal(await page.locator('.plan-placement-preview').count(), 4);
  await page.waitForTimeout(600);
  assert.equal(layout(await storedProject(page)).placements.length, 2);
  await page.screenshot({ path: `${output}/plan-batch.png`, fullPage: true });
  await pointOnPlan(page, 50, 16000, true);
  saved = await waitProject(page, (p) => layout(p).placements.length === 6);
  const added = layout(saved).placements.filter((p) => !['p-1', 'p-child'].includes(p.id));
  assert.equal(new Set(added.map((p) => p.id)).size, 4);
  assert.equal(added[0].s - added[1].s, 700);
  assert.equal(added[0].bottom - added[2].bottom, 850);
  await undo();
  await waitProject(page, (p) => layout(p).placements.length === 2);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitProject(page, (p) => layout(p).placements.length === 6);
  await undo();
  await waitProject(page, (p) => layout(p).placements.length === 2);
  check(
    'plan: count/columns/gaps dialog, red overlap prevention, four previews without saves, atomic grid placement and Undo/Redo',
  );

  await original().click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  const p = seed.layouts[0].placements[0],
    art = seed.artworks[0],
    wall = walls(seed.building, seed.layouts[0].partitions, seed.rails).find(
      (w) => w.id === p.wallId,
    ),
    pos = positionOnWall(wall, p.s, p.bottom, art);
  const focused = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  focused.position.set(
    pos.x / 1000 + wall.normal.x * 3,
    pos.y / 1000,
    pos.z / 1000 + wall.normal.z * 3,
  );
  focused.lookAt(pos.x / 1000, pos.y / 1000, pos.z / 1000);
  await at3D(focused, [pos.x, pos.y, pos.z], 'right');
  await menu().getByRole('menuitem', { name: '作品情報を表示', exact: true }).click();
  info = page.getByRole('dialog', { name: '作品情報', exact: true });
  await info.waitFor();
  await info.getByRole('button', { name: '閉じる', exact: true }).first().click();
  await at3D(focused, [pos.x, pos.y, pos.z], 'right');
  await menu().getByRole('menuitem', { name: '作品の配置を削除', exact: true }).click();
  await waitProject(page, (p) => layout(p).placements.length === 1);
  await undo();
  await waitProject(page, (p) => layout(p).placements.length === 2);
  check(
    '3D: right-click hits artwork without panning, metadata and placement deletion work, Undo restores it',
  );

  await beginBatch();
  await at3D(focused, [0, 1900, 5500]);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewValid === 'true',
  );
  assert.equal(await page.locator('.scene-host').getAttribute('data-preview-count'), '4');
  await page.screenshot({ path: `${output}/3d-batch.png`, fullPage: true });
  await at3D(focused, [0, 1900, 5500], 'left');
  saved = await waitProject(page, (p) => layout(p).placements.length === 6);
  await undo();
  await waitProject(page, (p) => layout(p).placements.length === 2);
  check('3D: all four grid previews render, one click adds four, one Undo removes four');

  await page.getByRole('button', { name: '平面', exact: true }).click();
  await pointOnPlan(page, 3300, seed.rails.find((r) => r.id === 'rail-cross-3').z1, true, 'right');
  await menu().getByRole('menuitem', { name: '可動壁を削除', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: '可動壁を削除しますか', exact: true });
  await confirm.getByRole('button', { name: '可動壁を削除', exact: true }).click();
  saved = await waitProject(page, (p) => layout(p).partitions.length === 0);
  assert.equal(layout(saved).placements.length, 1);
  assert.deepEqual(saved.artworks, seed.artworks);
  await undo();
  await waitProject(
    page,
    (p) => layout(p).partitions.length === 1 && layout(p).placements.length === 2,
  );
  check(
    'plan: partition right-click deletion also removes mounted placements, preserves catalog, and Undo restores both',
  );

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '全体を表示', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const overview = new THREE.PerspectiveCamera(50, 1, 0.03, 250),
    b = seed.building,
    g = partitionGeometry(seed.layouts[0].partitions[0], seed.rails);
  overview.position.set(b.mainWidth / 1000 + 22, 29, b.length / 1000 + 13);
  overview.lookAt((b.mainWidth - b.overallWidth) / 4000, 0, b.length / 2000);
  await at3D(overview, [g.x, 1500, g.z], 'right');
  await menu().getByRole('menuitem', { name: '可動壁を削除', exact: true }).click();
  confirm = page.getByRole('dialog', { name: '可動壁を削除しますか', exact: true });
  await confirm.getByRole('button', { name: '可動壁を削除', exact: true }).click();
  await waitProject(page, (p) => layout(p).partitions.length === 0);
  await undo();
  await waitProject(page, (p) => layout(p).partitions.length === 1);
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(
    page,
    (p) => layout(p).placements.length === 2 && layout(p).partitions.length === 1,
  );
  check('3D: partition right-click deletion, Undo and reload preserve the project');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
