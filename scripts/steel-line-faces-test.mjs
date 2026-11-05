import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject } from '../src/domain.js';
import { newSteelLine } from '../src/steelLinePlacement.js';
import {
  storedProject,
  waitProject,
  beginSteelLineDrawing,
  openWorkplaneCoordinates,
} from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(20000);
const output = 'test-results/steel-line-faces',
  root = path.resolve('dist'),
  errors = [],
  checks = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
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
    try {
      await route.fulfill({
        body: await fs.readFile(file),
        contentType:
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
          }[path.extname(file)] || 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
const layout = (p) => p.layouts.find((l) => l.id === p.activeLayoutId),
  membranes = (p) => layout(p).steelLineMembranes;
const check = (message) => {
  checks.push(message);
  console.log(message);
};
const field = async (name, value) => {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Enter');
};
const put = async (p) => {
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'faces.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  return waitProject(page, (q) => q.name === p.name);
};
const faceCount = async (count) =>
  page.waitForFunction(
    (count) => Number(document.querySelector('.scene-host').dataset.steelLineFaceCount) === count,
    count,
  );
const membraneCount = async (count) =>
  page.waitForFunction(
    (count) =>
      Number(document.querySelector('.scene-host').dataset.steelLineMembraneCount) === count,
    count,
  );
const savedExport = async (suffix, file) => {
  await page.waitForFunction(
    (suffix) => window.__exports.some((e) => e.name.endsWith(suffix) && e.data),
    suffix,
  );
  const data = await page.evaluate(
      (suffix) => window.__exports.filter((e) => e.name.endsWith(suffix)).at(-1).data,
      suffix,
    ),
    bytes = Buffer.from(data.split(',')[1], 'base64');
  await fs.writeFile(path.join(output, file), bytes);
  return bytes;
};
const points = [
  [2000, 1000, 14000],
  [5000, 1000, 14000],
  [5000, 3000, 14000],
  [2000, 3000, 14000],
];
const seed = createProject();
seed.name = 'ライン面とビニール膜の検証';
seed.layouts[0].steelFrames = points.map((p, i) =>
  newSteelLine(seed, p, points[(i + 1) % 4], 'c65', `line-${i}`),
);
let camera;
async function point(p, click = false) {
  const rect = await page.locator('canvas').boundingBox();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...p.map((x) => x / 1000)).project(camera),
    x = rect.x + ((v.x + 1) * rect.width) / 2,
    y = rect.y + ((1 - v.y) * rect.height) / 2;
  assert.ok(x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height);
  await page.mouse.move(x, y);
  if (click) await page.mouse.click(x, y);
}
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  await waitProject(page, (p) => !!p.frameShapes);
  await put(seed);
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await faceCount(1);
  await membraneCount(0);
  await page.getByRole('button', { name: /^ライン面 1/ }).click();
  await page.getByRole('button', { name: 'この面を拡大して確認', exact: true }).click();
  const distance = Math.sqrt(6) * 1.8;
  camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(3.5, 2 + distance * 0.25, 14 + distance);
  camera.lookAt(3.5, 2, 14);
  await page.waitForTimeout(700);
  await page.getByRole('checkbox', { name: 'このライン面に膜を貼る', exact: true }).check();
  await membraneCount(1);
  await waitProject(page, (p) => membranes(p).length === 1);
  await field('ライン面の膜の不透明度', 60);
  await page.getByLabel('ライン面の膜の色', { exact: true }).evaluate((input) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#55aaee');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  let p = await waitProject(
    page,
    (p) => membranes(p)[0]?.color === '#55aaee' && membranes(p)[0]?.opacity === 0.6,
  );
  await page.screenshot({ path: `${output}/membrane-3d.png`, fullPage: true });
  check('closed line loop generates a selectable face; membrane color and opacity update in 3D');
  await page.getByRole('button', { name: 'この面の膜を外す', exact: true }).click();
  await membraneCount(0);
  await waitProject(page, (p) => membranes(p).length === 0);
  await page.locator('.steel-frame-card').first().click();
  await page.getByRole('textbox', { name: '鉄骨ライン名', exact: true }).waitFor();
  await point([3500, 2000, 14000], true);
  await page.getByRole('checkbox', { name: 'このライン面に膜を貼る', exact: true }).check();
  await membraneCount(1);
  await field('ライン面の膜の不透明度', 65);
  p = await waitProject(page, (p) => membranes(p)[0]?.opacity === 0.65);
  check('empty face can be picked directly in 3D and its membrane can be removed and reapplied');
  await page.locator('.steel-frame-card').first().click();
  await field('ライン始点 X', 2100);
  await faceCount(0);
  await membraneCount(0);
  await waitProject(page, (p) => layout(p).steelFrames[0].x === 2100);
  assert.equal(membranes(await storedProject(page)).length, 1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await faceCount(1);
  await membraneCount(1);
  await waitProject(page, (p) => layout(p).steelFrames[0].x === 2000);
  await field('ライン始点 Y', 1200);
  await faceCount(1);
  await membraneCount(1);
  p = await waitProject(page, (p) => layout(p).steelFrames[0].y === 1200);
  assert.equal(membranes(p)[0].opacity, 0.65);
  await page.getByRole('button', { name: 'フレームを削除', exact: true }).click();
  await faceCount(0);
  await waitProject(page, (p) => membranes(p).length === 0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await faceCount(1);
  await membraneCount(1);
  await waitProject(page, (p) => membranes(p).length === 1);
  check(
    'opening a boundary hides the membrane, closing or undo restores it, and deletion cleans its binding',
  );
  const open = structuredClone(seed);
  open.name = 'クリックで面を閉じる検証';
  open.layouts[0].steelFrames.pop();
  await put(open);
  await faceCount(0);
  await page.getByRole('combobox', { name: '鉄骨ラインの作業面', exact: true }).selectOption('xy');
  await openWorkplaneCoordinates(page);
  await field('作業平面の中心 Z', 14000);
  await page.getByRole('checkbox', { name: '鉄骨ラインを連続配置', exact: true }).uncheck();
  await beginSteelLineDrawing(page);
  await point(points[3], true);
  await point(points[0], true);
  await faceCount(1);
  await page.locator('.steel-line-banner').waitFor({ state: 'hidden' });
  await page.getByRole('checkbox', { name: 'ライン面 1に膜を貼る', exact: true }).check();
  await membraneCount(1);
  p = await waitProject(page, (p) => membranes(p).length === 1);
  await page.getByRole('button', { name: '平面', exact: true }).click();
  assert.equal(await page.locator('.plan-panel [data-steel-line-face-id]').count(), 1);
  await page.screenshot({ path: `${output}/membrane-plan.png`, fullPage: true });
  p = await waitProject(page, (p) => p.displaySettings.view === 'plan');
  check(
    'drawing the final segment creates a face immediately; its membrane also appears in plan view',
  );
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  const json = JSON.parse((await savedExport('.ma.json', 'membrane.ma.json')).toString('utf8'));
  assert.deepEqual(json, p);
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (q) => membranes(q).length === 1);
  await put(seed);
  await put(json);
  await membraneCount(1);
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  const bytes = await savedExport('.glb', 'membrane.glb'),
    gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(gltf.nodes.some((n) => n.name?.includes('ビニール膜')));
  assert.ok(gltf.materials.some((m) => m.alphaMode === 'BLEND' && m.doubleSided));
  assert.ok(!gltf.nodes.some((n) => n.extras?.editorOnly || n.extras?.uiOnly));
  await page.getByRole('button', { name: '現在のプランを複製', exact: true }).click();
  await waitProject(page, (p) => p.layouts.length === 2);
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.getByRole('button', { name: /^ライン面 1/ }).click();
  await field('ライン面の膜の不透明度', 20);
  p = await waitProject(page, (p) => membranes(p)[0]?.opacity === 0.2);
  assert.equal(p.layouts[0].steelLineMembranes[0].opacity, 0.35);
  check(
    'membranes survive reload and JSON round-trip, export to GLB, and remain independent between plans',
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { status: 'passed', checks, errors, exportTransport: 'UI-generated Blobs' },
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
