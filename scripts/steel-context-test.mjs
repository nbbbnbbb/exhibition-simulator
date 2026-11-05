import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject } from '../src/domain.js';
import { newSteelFrame, frameGeometry } from '../src/steelFrames.js';
import { newSteelLine } from '../src/steelLinePlacement.js';
import { detectSteelLineFaces } from '../src/steelLineFaces.js';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(45000);
const root = path.resolve('dist'),
  output = 'test-results/steel-context',
  errors = [],
  checks = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
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
seed.name = '鉄骨の右クリック削除の検証';
const box = {
  ...newSteelFrame(seed, 'box', 'box'),
  name: 'ボックス検証',
  x: 3000,
  z: 18000,
  width: 2000,
  height: 1800,
  depth: 1600,
};
box.membrane.faces = [0, 4];
const frame = {
  ...newSteelFrame(seed, 'rectangle', 'frame'),
  name: 'フレーム検証',
  x: 6500,
  z: 18000,
  width: 1800,
  height: 2000,
};
frame.membrane.faces = [0];
const single = newSteelLine(seed, [2000, 0, 24000], [6000, 1500, 26000], 'c65', 'single');
single.name = '単独ライン検証';
const corners = [
  [2000, 1800, 10000],
  [5000, 1800, 10000],
  [5000, 1800, 13000],
  [2000, 1800, 13000],
];
const edges = corners.map((p, i) =>
  newSteelLine(seed, p, corners[(i + 1) % corners.length], 'c65', `edge-${i}`),
);
const face = detectSteelLineFaces(edges)[0];
seed.layouts[0].steelFrames = [box, frame, single, ...edges];
seed.layouts[0].steelLineMembranes = [
  { faceId: face.id, lineIds: face.lineIds, color: '#55aaee', opacity: 0.35 },
];
seed.layouts[0].placements = [];
seed.layouts.push({ ...structuredClone(seed.layouts[0]), id: 'other-layout', name: '別プラン' });
const active = (p) => p.layouts.find((l) => l.id === p.activeLayoutId),
  frames = (p) => active(p).steelFrames,
  menu = () => page.getByRole('menu'),
  undo = () => page.getByRole('button', { name: '元に戻す', exact: true }).click(),
  settle = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
const check = (message) => {
  checks.push(message);
  console.log(message);
};
async function restored() {
  return waitProject(
    page,
    (p) =>
      JSON.stringify(frames(p)) === JSON.stringify(seed.layouts[0].steelFrames) &&
      active(p).steelLineMembranes.length === 1,
  );
}
async function focus(f) {
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.locator('.steel-frame-card').filter({ hasText: f.name }).click();
  await page
    .getByRole('button', {
      name: f.kind === 'line' ? 'ラインを拡大して確認' : 'フレームを正面から確認',
      exact: true,
    })
    .click();
  await settle();
  const distance = Math.max(
    2,
    ((f.kind === 'line' ? Math.hypot(...f.lineEnd) : Math.max(f.width, f.height, f.depth)) / 1000) *
      1.7,
  );
  const target =
    f.kind === 'line'
      ? [f.x, f.y, f.z].map((v, i) => (v + f.lineEnd[i] / 2) / 1000)
      : [f.x / 1000, (f.y + f.height / 2) / 1000, f.z / 1000];
  const camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(
    target[0] + (f.kind === 'line' ? 0.45 : Math.sin((f.rotation * Math.PI) / 180)) * distance,
    target[1] + distance * (f.kind === 'line' ? 0.5 : 0.25),
    target[2] + Math.cos((f.rotation * Math.PI) / 180) * distance,
  );
  camera.lookAt(...target);
  return camera;
}
async function right3D(camera, point) {
  const rect = await page.locator('canvas').boundingBox();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...point.map((n) => n / 1000)).project(camera);
  const x = rect.x + ((v.x + 1) * rect.width) / 2,
    y = rect.y + ((1 - v.y) * rect.height) / 2;
  assert.ok(
    x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height,
    'target must be visible',
  );
  await page.mouse.click(x, y, { button: 'right' });
}
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  await waitProject(page, (p) => !!p.rails);
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'steel-context.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await waitProject(page, (p) => p.name === seed.name);
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await pointOnPlan(page, 6500, 18000, true, 'right');
  await page.getByRole('menu', { name: '鉄骨フレームのメニュー', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/frame-menu.png`, fullPage: true });
  await menu().getByRole('menuitem', { name: '鉄骨フレームを削除', exact: true }).click();
  let saved = await waitProject(page, (p) => !frames(p).some((f) => f.id === 'frame'));
  assert.equal(frames(saved).length, 6);
  assert.deepEqual(saved.layouts[1], seed.layouts[1]);
  await undo();
  await restored();
  check(
    'plan: right-click frame deletion affects only that frame in this plan; Undo restores its membrane',
  );

  await pointOnPlan(page, 4000, 25000, true, 'right');
  await menu().getByRole('menuitem', { name: '鉄骨ラインを削除', exact: true }).click();
  await waitProject(page, (p) => !frames(p).some((f) => f.id === 'single'));
  await undo();
  await restored();
  await pointOnPlan(page, 3500, 10000, true, 'right');
  await menu().getByRole('menuitem', { name: '鉄骨ラインを削除', exact: true }).click();
  saved = await waitProject(page, (p) => !frames(p).some((f) => f.id === 'edge-0'));
  assert.equal(active(saved).steelLineMembranes.length, 0);
  await undo();
  await restored();
  check(
    'plan: a single line deletes independently; deleting a boundary line also removes its dependent membrane atomically',
  );

  await pointOnPlan(page, 3000, 18000, true, 'right');
  await menu().getByRole('menuitem', { name: 'この面の膜を削除', exact: true }).click();
  saved = await waitProject(
    page,
    (p) => frames(p).find((f) => f.id === 'box').membrane.faces.length === 1,
  );
  assert.deepEqual(frames(saved).find((f) => f.id === 'box').membrane.faces, [0]);
  assert.equal(frames(saved).length, 7);
  await undo();
  await restored();
  await pointOnPlan(page, 3500, 11500, true, 'right');
  await menu().getByRole('menuitem', { name: 'この面の膜を削除', exact: true }).click();
  saved = await waitProject(page, (p) => active(p).steelLineMembranes.length === 0);
  assert.equal(frames(saved).length, 7);
  await undo();
  await restored();
  check(
    'plan: frame-face and line-face membrane deletion retains all structural members and other faces',
  );

  let camera = await focus(frame);
  const nodes = frameGeometry(frame, seed).nodes;
  const member = nodes[1].map((v, i) => (v + nodes[2][i]) / 2);
  await right3D(camera, member);
  await menu().getByRole('menuitem', { name: '鉄骨フレームを削除', exact: true }).click();
  await waitProject(page, (p) => !frames(p).some((f) => f.id === 'frame'));
  await undo();
  await restored();
  await settle();
  await right3D(camera, [frame.x, frame.height / 2, frame.z]);
  await page.getByRole('menu', { name: '膜のメニュー', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/membrane-menu.png`, fullPage: true });
  await menu().getByRole('menuitem', { name: 'この面の膜を削除', exact: true }).click();
  saved = await waitProject(
    page,
    (p) => frames(p).find((f) => f.id === 'frame').membrane.faces.length === 0,
  );
  assert.equal(frames(saved).length, 7);
  await undo();
  await restored();
  check(
    '3D: actual frame edges open frame menus; membrane interiors delete only face 0 and Undo restores it',
  );

  camera = await focus(single);
  await right3D(camera, [4000, 750, 25000]);
  await menu().getByRole('menuitem', { name: '鉄骨ラインを削除', exact: true }).click();
  await waitProject(page, (p) => !frames(p).some((f) => f.id === 'single'));
  await undo();
  await restored();
  await page
    .locator('.steel-line-face-row')
    .filter({ hasText: face.name })
    .getByRole('button')
    .click();
  await page.getByRole('button', { name: 'この面を拡大して確認', exact: true }).click();
  await settle();
  camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(3.5, 1.8 + (Math.sqrt(face.area) / 1000) * 1.8, 11.5);
  camera.lookAt(3.5, 1.8, 11.5);
  await right3D(camera, [3500, 1800, 11500]);
  await menu().getByRole('menuitem', { name: 'この面の膜を削除', exact: true }).click();
  saved = await waitProject(page, (p) => active(p).steelLineMembranes.length === 0);
  assert.equal(frames(saved).length, 7);
  await undo();
  await restored();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitProject(page, (p) => active(p).steelLineMembranes.length === 0);
  await undo();
  await restored();
  check(
    '3D: individual lines and membranes have distinct delete actions, including one-step Undo/Redo',
  );

  await page.reload({ waitUntil: 'networkidle' });
  saved = await restored();
  assert.deepEqual(saved.layouts[1], seed.layouts[1]);
  assert.deepEqual(errors, []);
  check(
    'reload preserves restored geometry and membranes; other plans are unchanged; no runtime errors',
  );
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify({ status: 'passed', checks, errors }, null, 2),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
