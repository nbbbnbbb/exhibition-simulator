import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { DEFAULT_BUILDING } from '../src/domain.js';
import { placeOnPlan } from './placement-test-helpers.mjs';
// Use the bundled Playwright when available; no browser download is needed on Windows.
let playwright;
try {
  playwright = await import('playwright');
} catch {
  const root =
    process.env.CODEX_NODE_MODULES ||
    'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1026-487-0_26.1026.487.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules';
  playwright = createRequire(path.join(root, 'package.json'))('playwright');
}
const { chromium } = playwright;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
await fs.mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '展示を、空間で考える。' }).waitFor();
  await page.getByText('保存済み', { exact: false }).first().waitFor();
  assert((await page.locator('canvas').count()) === 1, '3D canvas missing');
  // These two editions are used on both sides of a copied partition later.
  for (const title of ['静かな地平 / サンプル', 'かたちの対話 / サンプル']) {
    await page.getByRole('button', { name: `${title}を編集`, exact: true }).click();
    const quantity = page.getByRole('spinbutton', { name: '数量（配置上限）', exact: true });
    await quantity.fill('3');
    await quantity.press('Tab');
    await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  }
  await page.screenshot({ path: 'test-results/01-workspace.png', fullPage: true });
  // Committing a precise numeric edit updates both the document and saved storage.
  const s = page.getByTestId('position-s');
  await s.fill('6250');
  await s.press('Tab');
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('ma-exhibition-v1', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve) => {
        const r = db.transaction('projects').objectStore('projects').get('current');
        r.onsuccess = () => resolve(r.result?.layouts[0]?.placements[0]?.s === 6250);
      });
    } finally {
      db.close();
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.plan-art').first().locator('line').last().click({ force: true });
  await page.getByTestId('position-s').waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-s]')?.value === '6250',
  );
  assert(
    (await page.getByTestId('position-s').inputValue()) === '6250',
    'numeric edit did not persist',
  );
  // Undo, redo and centre height.
  const bottom = page.getByTestId('position-bottom');
  await bottom.fill('1234');
  await bottom.press('Tab');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-bottom]').value === '950',
  );
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-bottom]').value === '1234',
  );
  await page.getByRole('button', { name: '中心高を 1,500 mm に揃える', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-bottom]').value === '950',
  );
  // Dragging uses the same wall-local coordinate in SVG and WebGL.
  const planArt = await page.locator('.plan-art').first().locator('line').last().boundingBox();
  await page.mouse.move(planArt.x + planArt.width / 2, planArt.y + planArt.height / 2);
  await page.mouse.down();
  await page.mouse.move(planArt.x + planArt.width / 2, planArt.y + planArt.height / 2 + 12, {
    steps: 4,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-s]').value !== '6250',
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-s]').value === '6250',
  );
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await page.waitForTimeout(500);
  const canvas = await page.locator('canvas').boundingBox();
  const cx = canvas.x + canvas.width / 2,
    cy = canvas.y + canvas.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 18, cy + 12, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-bottom]').value !== '950',
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=position-bottom]').value === '950',
  );
  await page.screenshot({ path: 'test-results/04-focus.png', fullPage: true });
  // Register a real raster upload, enter its dimensions, place it.
  const png = await page.locator('canvas').screenshot();
  await page.getByRole('button', { name: '作品を登録', exact: true }).click();
  await page
    .locator('.modal input[type=file]')
    .setInputFiles({ name: 'test-art.png', mimeType: 'image/png', buffer: png });
  await page.getByAltText('作品画像プレビュー', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '作品名', exact: true }).fill('検証作品');
  const width = page.getByRole('spinbutton', { name: '幅', exact: true });
  await width.fill('1234');
  await width.press('Tab');
  const height = page.getByRole('spinbutton', { name: '高さ', exact: true });
  await height.fill('876');
  await height.press('Tab');
  await page.getByRole('button', { name: 'ライブラリに登録', exact: false }).click();
  await page.getByRole('dialog', { name: '作品を登録', exact: true }).waitFor({ state: 'hidden' });
  await placeOnPlan(page, '検証作品', 50, 16000);
  assert(
    (await page.getByText('1,234', { exact: true }).count()) > 0,
    'uploaded art width missing',
  );
  // Plan cloning and overlay comparison.
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在のプランを複製', exact: true }).click();
  await page.locator('#compare-select').selectOption('layout-1');
  assert((await page.locator('.ghost-art').count()) === 5, 'comparison overlay missing');
  await page.getByRole('button', { name: '歩く', exact: true }).click();
  await page.waitForFunction(
    (spawnZ) =>
      Number(document.querySelector('.plan-panel svg.plan-svg')?.getAttribute('data-camera-z')) ===
      spawnZ,
    DEFAULT_BUILDING.length - 8000,
  );
  const startZ = Number(
    await page.locator('.plan-panel svg.plan-svg').getAttribute('data-camera-z'),
  );
  await page.locator('canvas').focus();
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(
      (start) =>
        Number(document.querySelector('.plan-panel svg.plan-svg')?.getAttribute('data-camera-z')) <
        start - 100,
      startZ,
    );
  } finally {
    await page.keyboard.up('KeyW');
  }
  const endZ = Number(await page.locator('.plan-panel svg.plan-svg').getAttribute('data-camera-z'));
  assert(endZ < startZ - 100, 'W did not move camera forward');
  assert((await page.getByText('WALKTHROUGH', { exact: false }).count()) > 0, 'walk mode missing');
  await page.screenshot({ path: 'test-results/05-walk.png', fullPage: true });
  // Unsupported VR produces a clear, actionable status instead of failing silently.
  await page.getByRole('button', { name: /VR 1:1/ }).click();
  await page
    .getByRole('status')
    .filter({ hasText: /VR|ヘッドセット/ })
    .waitFor();
  await page.getByRole('button', { name: '俯瞰', exact: true }).click();
  await page.getByRole('button', { name: '建築・寸法データ', exact: false }).click();
  await page.getByText('寸法列の合計差 2,762 mm / 幅基準の差 133 mm', { exact: true }).waitFor();
  await page.getByRole('button', { name: '採用寸法を編集', exact: true }).click();
  const ceiling = page.getByRole('spinbutton', { name: '天井高', exact: true });
  await ceiling.fill('5700');
  await ceiling.press('Tab');
  await page.getByRole('button', { name: '建築寸法を適用', exact: true }).click();
  // Export/import round trip, all images and plans included.
  const dlPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  const dl = await dlPromise;
  const out = path.resolve('test-results/export.ma.json');
  await dl.saveAs(out);
  const json = JSON.parse(await fs.readFile(out, 'utf8'));
  assert(json.building.height === 5700, 'building edit missing');
  assert(json.layouts.length === 2, 'layouts missing from export');
  assert(json.artworks.at(-1).width === 1234, 'image metadata missing');
  await page.locator('.header-actions input[type=file]').setInputFiles(out);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' });
  assert(
    (await page.getByRole('textbox', { name: 'プロジェクト名' }).inputValue()) === json.name,
    'import/reload failed',
  );
  // Add a 3,000 x 5,000 x 200 mm partition on a dotted rail and move it precisely.
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.getByRole('button', { name: '＋ 可動壁を追加', exact: true }).click();
  await page.getByTestId('partition-width').waitFor();
  assert(
    (await page.getByTestId('partition-width').inputValue()) === '3000',
    'partition default width',
  );
  const partS = page.getByTestId('partition-s');
  await partS.fill('5000');
  await partS.press('Tab');
  const partHit = await page.locator('.plan-partition').first().locator('line').boundingBox();
  await page.mouse.move(partHit.x + partHit.width / 2, partHit.y + partHit.height / 2);
  await page.mouse.down();
  await page.mouse.move(partHit.x + partHit.width / 2 + 12, partHit.y + partHit.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=partition-s]').value !== '5000',
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=partition-s]').value === '5000',
  );
  // Project the wall centre through the actual overview camera, then drag its mesh.
  const cbox = await page.locator('canvas').boundingBox();
  const cam = new THREE.PerspectiveCamera(50, cbox.width / cbox.height, 0.03, 250);
  cam.position.set(json.building.mainWidth / 1000 + 22, 29, json.building.length / 1000 + 13);
  cam.lookAt(
    (json.building.mainWidth - json.building.overallWidth) / 4000,
    0,
    json.building.length / 2000,
  );
  cam.updateMatrixWorld();
  const rail = json.rails.find((r) => r.id === 'rail-cross-3');
  const projected = new THREE.Vector3(5, 2.5, rail.z1 / 1000).project(cam);
  const px = cbox.x + ((projected.x + 1) / 2) * cbox.width,
    py = cbox.y + ((1 - projected.y) / 2) * cbox.height;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 15, py, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=partition-s]').value !== '5000',
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=partition-s]').value === '5000',
  );
  const partId = await page.locator('.plan-partition').getAttribute('data-partition-id');
  // Place works on both sides; preserve their local coordinates when rotating the wall.
  await page.getByRole('button', { name: '作品を選んで、この面に配置', exact: true }).click();
  await placeOnPlan(page, '静かな地平 / サンプル', 5000, rail.z1 - 120);
  assert(
    (await page.getByRole('combobox', { name: '配置する壁面' }).inputValue()) ===
      `partition:${partId}:front`,
    'art not mounted on front',
  );
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.locator('.partition-card').first().click();
  await page.getByRole('button', { name: '裏面', exact: true }).click();
  await page.getByRole('button', { name: '作品を選んで、この面に配置', exact: true }).click();
  await placeOnPlan(page, 'かたちの対話 / サンプル', 5000, rail.z1 + 120);
  assert(
    (await page.getByRole('combobox', { name: '配置する壁面' }).inputValue()) ===
      `partition:${partId}:back`,
    'art not mounted on back',
  );
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.locator('.partition-card').first().click();
  await page
    .getByRole('combobox', { name: '可動壁の配置ライン', exact: true })
    .selectOption('rail-centre');
  await partS.fill('5000');
  await partS.press('Tab');
  assert(
    (await page.locator(`.plan-art[data-partition-owner="${partId}"]`).count()) === 2,
    'mounted works did not follow wall',
  );
  await page.getByRole('button', { name: '壁を複製', exact: true }).click();
  assert((await page.locator('.plan-partition').count()) === 2, 'partition clone missing');
  await page.getByRole('button', { name: '壁を削除', exact: true }).click();
  await page.getByRole('button', { name: '可動壁を削除', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.locator('.partition-card').first().click();
  assert((await page.locator('.plan-partition').count()) === 2, 'partition deletion undo missing');
  await page.getByRole('button', { name: '配置ラインの座標を編集 →', exact: true }).click();
  const centreX = json.rails.find((r) => r.id === 'rail-centre').x1 + 100;
  for (const label of ['主室 中央縦線 始点 X', '主室 中央縦線 終点 X']) {
    const f = page.getByRole('spinbutton', { name: label, exact: true });
    await f.fill(String(centreX));
    await f.press('Tab');
  }
  await page.getByRole('button', { name: '配置ラインを適用', exact: true }).click();
  await page.screenshot({ path: 'test-results/06-partitions.png', fullPage: true });
  const wallExportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  const wallExport = await wallExportPromise;
  const wallOut = path.resolve('test-results/partitions.ma.json');
  await wallExport.saveAs(wallOut);
  const withWalls = JSON.parse(await fs.readFile(wallOut, 'utf8'));
  assert(
    withWalls.layouts.find((l) => l.id === withWalls.activeLayoutId).partitions.length === 2,
    'partition persistence missing',
  );
  assert(
    withWalls.rails.find((r) => r.id === 'rail-centre').x1 === centreX,
    'edited rail not saved',
  );
  await page.locator('.header-actions input[type=file]').setInputFiles(wallOut);
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: 'networkidle' });
  assert((await page.locator('.plan-partition').count()) === 2, 'partition import/reload missing');
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  const csvPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '全プランの設営CSV', exact: true }).click();
  const csv = await csvPromise;
  const csvPath = path.resolve('test-results/installation.csv');
  await csv.saveAs(csvPath);
  assert(
    (await fs.readFile(csvPath, 'utf8')).includes('可動壁 01'),
    'mounted works missing from CSV',
  );
  const glbPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  const glb = await glbPromise;
  const glbPath = path.resolve('test-results/exhibition.glb');
  await glb.saveAs(glbPath);
  const buffer = await fs.readFile(glbPath);
  assert(buffer.readUInt32LE(0) === 0x46546c67, 'invalid GLB header');
  const chunkLength = buffer.readUInt32LE(12);
  const model = JSON.parse(buffer.subarray(20, 20 + chunkLength).toString('utf8'));
  assert(
    model.nodes.some((n) => {
      const t = n.translation || n.matrix?.slice(12, 15);
      return (
        t &&
        Math.abs(t[0] - 0.0255) < 1e-6 &&
        Math.abs(t[1] - 1.5) < 1e-6 &&
        Math.abs(t[2] - 6.25) < 1e-6
      );
    }),
    'GLB metre coordinates differ from placement',
  );
  await page.screenshot({ path: 'test-results/02-edited.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/03-mobile.png', fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'mobile overflow',
  );
  assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  const result = {
    status: 'passed',
    checks: [
      'WebGL rendering',
      'numeric precision',
      'IndexedDB persistence',
      'undo/redo',
      'height alignment',
      'plan drag',
      '3D drag',
      'raster image registration',
      'layout cloning',
      'comparison overlay',
      'walk displacement',
      'VR fallback',
      'building edit',
      'JSON export/import',
      'partition dimensions',
      'partition plan drag',
      'partition 3D drag',
      'mount artwork on both faces',
      'partition rotation and artwork tracking',
      'partition clone/delete/undo',
      'rail coordinate editing',
      'partition persistence/import',
      'installation CSV',
      'GLB metre coordinates',
      'responsive layout',
    ],
    browserErrors: errors,
  };
  await fs.writeFile('test-results/report.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
