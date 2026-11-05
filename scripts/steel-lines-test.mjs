import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject } from '../src/domain.js';
import { newSteelFrame } from '../src/steelFrames.js';
import { steelLineEndpoints } from '../src/steelLinePlacement.js';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(20000);
const output = 'test-results/steel-lines',
  root = path.resolve('dist'),
  checks = [],
  errors = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (err) => errors.push(err.message));
await page.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL),
    click = HTMLAnchorElement.prototype.click,
    blobs = new Map();
  window.__exports = [];
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && blobs.has(this.href)) {
      const item = { name: this.download, data: null };
      window.__exports.push(item);
      const r = new FileReader();
      r.onload = () => {
        item.data = r.result;
      };
      r.readAsDataURL(blobs.get(this.href));
      return;
    }
    return click.call(this);
  };
});
if (!process.env.MA_TEST_URL)
  await page.route('http://127.0.0.1:5173/**', async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname),
      file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
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
const frames = (p) => p.layouts.find((l) => l.id === p.activeLayoutId).steelFrames,
  lines = (p) => frames(p).filter((f) => f.kind === 'line');
const field = async (name, value) => {
  const el = page.getByRole('spinbutton', { name, exact: true });
  await el.fill(String(value));
  await el.press('Enter');
};
const check = (message) => {
  checks.push(message);
  console.log(message);
};
let camera;
async function at(point, { click = false, dx = 0, dy = 0 } = {}) {
  const r = await page.locator('canvas').boundingBox();
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...point.map((v) => v / 1000)).project(camera),
    x = r.x + ((v.x + 1) * r.width) / 2 + dx,
    y = r.y + ((1 - v.y) * r.height) / 2 + dy;
  assert.ok(
    x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height,
    'test point must be inside canvas',
  );
  await page.mouse.move(x, y);
  if (click) await page.mouse.click(x, y);
  return { x, y };
}
const put = async (p) => {
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'steel-line-test.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  return waitProject(page, (q) => q.name === p.name);
};
const exported = async (suffix, filename) => {
  await page.waitForFunction(
    (suffix) => window.__exports.some((e) => e.name.endsWith(suffix) && e.data),
    suffix,
  );
  const data = await page.evaluate(
    (suffix) => window.__exports.find((e) => e.name.endsWith(suffix)).data,
    suffix,
  );
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  await fs.writeFile(path.join(output, filename), bytes);
  return bytes;
};
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  await waitProject(page, (p) => !!p.frameShapes);
  const seed = createProject();
  seed.name = '鉄骨ライン3D配置の検証';
  seed.layouts[0].steelFrames.push(newSteelFrame(seed, 'rectangle'));
  await put(seed);
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.locator('.steel-frame-card').first().click();
  await page.getByRole('button', { name: 'フレームを正面から確認', exact: true }).click();
  const f = frames(seed)[0],
    d = (Math.max(f.width, f.height) / 1000) * 1.7;
  camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(f.x / 1000, f.height / 2000 + d * 0.25, f.z / 1000 + d);
  camera.lookAt(f.x / 1000, f.height / 2000, f.z / 1000);
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '3Dでライン配置を開始', exact: true }).click();
  const a = [3200, 1500, 14000],
    b = [5600, 1500, 14000],
    c = [5600, 2800, 14000],
    e = [5600, 2800, 16000];
  await at(a, { click: true });
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelLineStart === '3200,1500,14000',
  );
  assert.equal(lines(await storedProject(page)).length, 0);
  await at(b);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelLineValid === 'true',
  );
  assert.equal(lines(await storedProject(page)).length, 0, 'hover must not save');
  await at(b, { click: true });
  await waitProject(page, (p) => lines(p).length === 1);
  await page.getByRole('combobox', { name: '鉄骨ラインの作業面', exact: true }).selectOption('xy');
  assert.equal(
    await page.getByRole('spinbutton', { name: '作業面の位置 Z', exact: true }).inputValue(),
    '14000',
  );
  await at(c, { click: true });
  await waitProject(page, (p) => lines(p).length === 2);
  await page.getByRole('combobox', { name: '鉄骨ラインの作業面', exact: true }).selectOption('yz');
  await at(e, { click: true });
  let p = await waitProject(page, (p) => lines(p).length === 3);
  assert.deepEqual(lines(p).map(steelLineEndpoints), [
    [a, b],
    [b, c],
    [c, e],
  ]);
  await page.keyboard.press('Enter');
  await page.locator('.steel-line-banner').waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${output}/3d-chain.png`, fullPage: true });
  check(
    '3D clicks on XZ / XY / YZ planes form a continuous three-dimensional chain; hover is not saved',
  );
  await page.locator('.steel-frame-card').nth(1).click();
  await field('ライン終点 Y', 2000);
  p = await waitProject(page, (p) => lines(p)[0].lineEnd[1] === 500);
  const line = lines(p)[0],
    mid = steelLineEndpoints(line)[0].map((v, i) => v + line.lineEnd[i] / 2),
    start = await at(mid);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 8, { steps: 6 });
  await page.mouse.up();
  p = await waitProject(page, (p) => lines(p)[0].x !== line.x || lines(p)[0].z !== line.z);
  assert.deepEqual(lines(p)[0].lineEnd, line.lineEnd);
  check('endpoint coordinates create an inclined member and 3D dragging preserves its vector');
  await page.getByRole('button', { name: '3Dでライン配置を開始', exact: true }).click();
  const snapped = steelLineEndpoints(lines(p)[0])[0];
  await at(snapped, { dx: 3, dy: 1 });
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelLineSnapped === 'true',
  );
  await at(snapped, { click: true });
  await page.waitForFunction(
    (s) => document.querySelector('.scene-host').dataset.steelLineStart === s,
    snapped.join(','),
  );
  await page.getByRole('combobox', { name: '鉄骨ラインの作業面', exact: true }).selectOption('xy');
  await at([4500, 2500, snapped[2]], { click: true });
  p = await waitProject(page, (p) => lines(p).length === 4);
  await at([4000, 0, snapped[2]]);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelLineValid === 'false',
  );
  await at([4000, 0, snapped[2]], { click: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  assert.equal(lines(await storedProject(page)).length, 4);
  check(
    'existing endpoints snap across work planes; invalid floor endpoints and Escape do not add members',
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitProject(page, (p) => lines(p).length === 3);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitProject(page, (p) => lines(p).length === 4);
  await page.getByRole('combobox', { name: '鉄骨ラインの作業面', exact: true }).selectOption('xz');
  await page.getByRole('checkbox', { name: '鉄骨ラインを連続配置', exact: true }).uncheck();
  await page.getByRole('button', { name: '3Dでライン配置を開始', exact: true }).click();
  await page.keyboard.down('Alt');
  await at([3201, 1500, 16001], { click: true });
  await at([4501, 1500, 16001], { click: true });
  await page.keyboard.up('Alt');
  p = await waitProject(page, (p) => lines(p).length === 5);
  assert.deepEqual(steelLineEndpoints(lines(p).at(-1)), [
    [3201, 1500, 16001],
    [4501, 1500, 16001],
  ]);
  await page.locator('.steel-line-banner').waitFor({ state: 'hidden' });
  check('one-step undo/redo, 1 mm Alt placement and automatic finish for a single segment');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await page.locator('.steel-frame-card').nth(1).click();
  const before = lines(p)[0];
  // The inclined branch shares the first part of this line's plan projection.
  // Grab beyond that overlap so the test targets the intended member.
  const grabPoint = [before.x + before.lineEnd[0] * 0.6, before.z + before.lineEnd[2] * 0.6];
  const targetId = await page.locator('.plan-panel svg.plan-svg').evaluate((svg, [x, z]) => {
    const point = new DOMPoint(x, z).matrixTransform(svg.getScreenCTM());
    return document.elementFromPoint(point.x, point.y)?.closest('[data-steel-frame-id]')?.dataset
      .steelFrameId;
  }, grabPoint);
  assert.equal(targetId, before.id, 'plan drag starts on the intended member');
  await pointOnPlan(page, ...grabPoint);
  await page.mouse.down();
  await pointOnPlan(page, grabPoint[0] + 500, grabPoint[1] + 700);
  await page.mouse.up();
  p = await waitProject(page, (p) => lines(p)[0].x !== before.x);
  assert.deepEqual(lines(p)[0].lineEnd, before.lineEnd);
  await page.screenshot({ path: `${output}/plan-lines.png`, fullPage: true });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.screenshot({ path: `${output}/3d-lines.png`, fullPage: true });
  check('plan view renders and drags individual lines without changing their geometry');
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  const json = JSON.parse((await exported('.ma.json', 'lines.ma.json')).toString('utf8'));
  assert.deepEqual(json, p);
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (q) => lines(q).length === 5);
  await put({ ...seed, name: '一時的に空にしたテスト' });
  await put(json);
  assert.deepEqual(lines(await storedProject(page)), lines(p));
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  const bytes = await exported('.glb', 'lines.glb'),
    gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.nodes.filter((n) => n.name?.startsWith('鉄骨ライン')).length >= 5);
  assert.ok(!gltf.nodes.some((n) => n.extras?.uiOnly || n.extras?.editorOnly));
  check('IndexedDB reload, JSON export/import and GLB export preserve the drawn members');
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { status: 'passed', checks, errors, exportTransport: 'UI-generated Blobs' },
      null,
      2,
    ),
  );
} catch (err) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify({ status: 'failed', checks, errors, error: err.stack }, null, 2),
  );
  await fs
    .writeFile(`${output}/failure-project.json`, JSON.stringify(await storedProject(page), null, 2))
    .catch(() => {});
  throw err;
} finally {
  await browser.close();
}
