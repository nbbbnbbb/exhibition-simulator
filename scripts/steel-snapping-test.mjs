import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject, fitPartition, partitionGeometry } from '../src/domain.js';
import { newSteelFrame } from '../src/steelFrames.js';
import { newSteelLine, steelLineEndpoints } from '../src/steelLinePlacement.js';
import { storedProject, waitProject, confirmSteelWorkplane } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(30000);
const output = 'test-results/steel-snapping',
  root = path.resolve('dist'),
  checks = [],
  errors = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
if (!process.env.MA_TEST_URL)
  await page.route('http://127.0.0.1:5173/**', async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
    try {
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
      };
      await route.fulfill({
        body: await fs.readFile(file),
        contentType: types[path.extname(file)] || 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
const host = page.locator('.scene-host');
const snapToggle = page.getByRole('checkbox', { name: '鉄骨配置のスナップ', exact: true });
const orthoToggle = page.getByRole('checkbox', { name: '鉄骨ラインの直交モード', exact: true });
const frames = (p) => p.layouts.find((l) => l.id === p.activeLayoutId).steelFrames;
const check = (message) => {
  checks.push(message);
  console.log(message);
};
const settle = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const data = (key) => host.getAttribute(`data-${key}`);
const point = async () => (await data('steel-line-point')).split(',').map(Number);
let camera;
async function at(p, { click = false, dx = 0, dy = 0, button = 'left' } = {}) {
  const r = await page.locator('canvas').boundingBox();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...p.map((n) => n / 1000)).project(camera);
  const x = r.x + ((v.x + 1) * r.width) / 2 + dx,
    y = r.y + ((1 - v.y) * r.height) / 2 + dy;
  assert.ok(x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height, `point visible: ${p}`);
  await page.mouse.move(x, y);
  if (click) await page.mouse.click(x, y, { button });
}
async function seedScene(name, extra = [], width = 3000, partitions = []) {
  const seed = createProject();
  seed.name = name;
  seed.layouts[0].placements = [];
  seed.layouts[0].partitions = partitions;
  const f = { ...newSteelFrame(seed, 'rectangle'), width };
  seed.layouts[0].steelFrames = [f, ...extra];
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'snapping.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await waitProject(page, (p) => p.name === name);
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.locator('.steel-frame-card').first().click();
  await page.getByRole('button', { name: 'フレームを正面から確認', exact: true }).click();
  const d = (Math.max(f.width, f.height) / 1000) * 1.7;
  camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(f.x / 1000, f.height / 2000 + d * 0.25, f.z / 1000 + d);
  camera.lookAt(f.x / 1000, f.height / 2000, f.z / 1000);
  await settle();
}
async function expectPreview(test) {
  for (let i = 0; i < 60; i++) {
    const p = await point();
    if (test(p)) return p;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `unexpected preview ${await data('steel-line-point')}; ${await data('steel-line-snap-label')}`,
  );
}
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  await waitProject(page, (p) => !!p.frameShapes);
  const target = newSteelLine(
    createProject(),
    [5050, 1500, 15000],
    [5050, 3000, 15000],
    'c65',
    'snap-target',
  );
  await seedScene('鉄骨スナップの画面検証', [target]);
  assert.equal(await snapToggle.isChecked(), true);
  assert.equal(await orthoToggle.isChecked(), false);
  await page.getByRole('button', { name: '作業平面を配置', exact: true }).click();
  await settle();
  await at([2500, 1500, 15000]);
  await page.mouse.down();
  await at([3000, 1500, 15000]);
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelWorkplaneCenter === '5050,1500,15000',
  );
  assert.equal(await data('steel-workplane-snapped'), 'true');
  assert.equal(await data('steel-line-snap-label'), '鉄骨の端点');
  assert.equal(frames(await storedProject(page)).length, 2);
  await page.screenshot({ path: `${output}/plane-snap.png`, fullPage: true });
  check(
    'workplane surface drag snaps its center to an existing steel endpoint without adding geometry',
  );
  await snapToggle.uncheck();
  await at([2500, 1500, 15000]);
  await page.mouse.down();
  await at([2450, 1500, 15000]);
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelWorkplaneCenter === '5000,1500,15000',
  );
  assert.equal(await data('steel-workplane-snapped'), 'false');
  check('workplane snap OFF permits movement next to an existing endpoint');
  await snapToggle.check();
  await confirmSteelWorkplane(page);
  await at([5050, 1500, 15000], { dx: 3 });
  await expectPreview((p) => p.join(',') === '5050,1500,15000');
  assert.equal(await data('steel-line-snapped'), 'true');
  await at([5050, 1500, 15000], { dx: 3, click: true });
  await at([5050, 2200, 15000], { dx: 3 });
  await expectPreview((p) => p[0] === 5050 && p[2] === 15000 && Math.abs(p[1] - 2200) < 100);
  assert.equal(await data('steel-line-snap-label'), '鉄骨の部材');
  check('line endpoints and positions along an existing member snap in 3D');
  await snapToggle.uncheck();
  await at([5050, 1500, 15000], { dx: 5 });
  await expectPreview((p) => p.join(',') !== '5050,1500,15000');
  assert.equal(await data('steel-line-snapped'), 'false');
  check('line snap OFF stops object acquisition during drawing');
  await snapToggle.check();
  await orthoToggle.check();
  await at([6500, 1500, 15800]);
  await expectPreview((p) => p[1] === 1500 && p[2] === 15000 && p[0] > 6000);
  assert.equal(await data('steel-line-orthogonal-axis'), 'X');
  await at([6500, 1500, 15800], { click: true });
  let saved = await waitProject(page, (p) => frames(p).length === 3);
  assert.deepEqual(steelLineEndpoints(frames(saved)[2]), [
    [5050, 1500, 15000],
    [6500, 1500, 15000],
  ]);
  await orthoToggle.uncheck();
  await at([7000, 1500, 16000]);
  await expectPreview((p) => p[0] === 7000 && p[2] === 16000);
  assert.equal(await data('steel-line-orthogonal-axis'), '');
  await orthoToggle.check();
  await at([7000, 1500, 16000]);
  await expectPreview((p) => p[0] === 6500 && p[2] === 16000);
  assert.equal(await data('steel-line-orthogonal-axis'), 'Z');
  await page.screenshot({ path: `${output}/orthogonal-mode.png`, fullPage: true });
  check('orthogonal mode toggles live, constrains X/Z, and commits the constrained endpoint');
  await page.getByRole('button', { name: 'ライン配置を終了', exact: true }).click();
  await seedScene('建物スナップの画面検証', [], 8000);
  await orthoToggle.uncheck();
  await page.getByRole('button', { name: '作業平面を配置', exact: true }).click();
  await confirmSteelWorkplane(page);
  await at([0, 0, 0], { dx: 3 });
  await expectPreview((p) => p.join(',') === '0,0,0');
  assert.equal(await data('steel-line-snap-label'), '床の角');
  await at([0, 1500, 0], { dx: 3 });
  await expectPreview((p) => p[0] === 0 && p[2] === 0 && Math.abs(p[1] - 1500) < 150);
  assert.equal(await data('steel-line-snap-label'), '建物の壁の辺');
  check('building floor corners and vertical wall edges are acquired from the actual 3D view');
  await at([1000, 1500, 0], { click: true });
  await orthoToggle.check();
  await at([10, 1500, 10]);
  await expectPreview((p) => p.join(',') === '0,1500,0');
  assert.equal(await data('steel-line-snapped'), 'true');
  assert.equal(await data('steel-line-orthogonal-axis'), 'X');
  await at([10, 1500, 10], { click: true });
  saved = await waitProject(page, (p) => frames(p).length === 2);
  assert.deepEqual(
    steelLineEndpoints(frames(saved)[1]).map((end) => end.map((n) => (Object.is(n, -0) ? 0 : n))),
    [
      [1000, 1500, 0],
      [0, 1500, 0],
    ],
  );
  await page.screenshot({ path: `${output}/building-snap.png`, fullPage: true });
  check('building-edge snapping and orthogonal mode combine without leaving the chosen axis');
  await page.getByRole('button', { name: 'ライン配置を終了', exact: true }).click();
  const contextSeed = createProject();
  const partition = fitPartition(
    {
      id: 'context-wall',
      name: '右クリック検証の壁',
      railId: 'rail-cross-3',
      s: 4500,
      width: 3000,
      height: 5000,
      thickness: 200,
    },
    contextSeed.building,
    contextSeed.rails,
  );
  const g = partitionGeometry(partition, contextSeed.rails);
  await seedScene('鉄骨配置と右クリックの両立', [], 3000, [partition]);
  await at([g.x, 2000, g.z], { click: true, button: 'right' });
  await page.getByRole('menu', { name: '可動壁のメニュー', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.getByRole('button', { name: '作業平面を配置', exact: true }).click();
  await at([g.x, 2000, g.z], { click: true, button: 'right' });
  assert.equal(await data('steel-workplane-phase'), 'plane');
  assert.equal(await page.getByRole('menu').count(), 0);
  await confirmSteelWorkplane(page);
  await at([g.x, 2000, g.z], { click: true, button: 'right' });
  assert.equal(await data('steel-workplane-phase'), 'draw');
  assert.equal(await page.getByRole('menu').count(), 0);
  assert.equal(frames(await storedProject(page)).length, 1);
  check(
    'normal object menus work, while right-click during steel placement preserves plane/drawing mode',
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { status: 'passed', url: process.env.MA_TEST_URL || 'local build', checks, errors },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify({ status: 'failed', checks, errors, error: error.stack }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
