import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject, walls } from '../src/domain.js';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
// An isolated browser profile and an in-process production build avoid touching
// the user's saved project or depending on a local development server.
const root = path.resolve('dist');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
await page.route('http://127.0.0.1:5173/**', async (route) => {
  const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
  try {
    await route.fulfill({
      body: await fs.readFile(file),
      contentType: types[path.extname(file)] || 'application/octet-stream',
    });
  } catch {
    await route.fulfill({ status: 404, body: '' });
  }
});
const output = 'test-results/artwork-group-move',
  errors = [],
  checks = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
function checked(message) {
  checks.push(message);
  console.log(message);
}
const ps = (p) => p.layouts[0].placements;
const seed = createProject();
seed.name = '複数作品のドラッグ検証';
Object.assign(ps(seed)[0], { s: 10000, bottom: 900 });
Object.assign(ps(seed)[1], { s: 12000, bottom: 1450 });
ps(seed)[2].s = 23000;
seed.artworkLabels.enabled = false;
seed.layouts[0].lighting.spots = false;
const original = structuredClone(ps(seed));

async function put(project = seed) {
  await page.evaluate(
    (data) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('ma-exhibition-v1', 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').put(data, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    project,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (p) => p.name === project.name);
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '配置の詳細', exact: true })
    .click();
}
async function select(ids = ['p-1', 'p-2']) {
  await page.getByRole('button', { name: '平面', exact: true }).click();
  for (const [i, id] of ids.entries())
    await page
      .locator(`.plan-panel .plan-art[data-placement-id="${id}"] line`)
      .last()
      .click({ force: true, modifiers: i ? ['Shift'] : [] });
}
const preview = () =>
  page.locator('.scene-host').evaluate((el) => ({
    valid: el.dataset.previewValid === 'true',
    wallId: el.dataset.previewWall,
    s: Number(el.dataset.previewS),
    bottom: Number(el.dataset.previewBottom),
    count: Number(el.dataset.previewCount),
    moving: Number(el.dataset.movingCount),
  }));
async function beginPlan(fromX, fromZ, toX, toZ) {
  await pointOnPlan(page, fromX, fromZ);
  await page.mouse.down();
  await pointOnPlan(page, toX, toZ);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.movingCount === '2',
  );
}
async function unchanged(expected = original) {
  assert.deepEqual(ps(await storedProject(page)), expected);
}
async function waitPlacements(predicate) {
  return ps(await waitProject(page, (p) => predicate(ps(p))));
}
function verifyGroup(placements, wallId, sign = 1) {
  const [a, b] = placements;
  assert.equal(a.wallId, wallId);
  assert.equal(b.wallId, wallId);
  assert.equal(b.s - a.s, 2000 * sign);
  assert.equal(b.bottom - a.bottom, 550);
  assert.deepEqual(placements.slice(2), original.slice(2));
}
async function projectPoint(point, camera) {
  const box = await page.locator('canvas').boundingBox();
  camera.aspect = box.width / box.height;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: box.x + ((p.x + 1) * box.width) / 2, y: box.y + ((1 - p.y) * box.height) / 2 };
}
async function begin3D(from, to, camera) {
  const a = await projectPoint(from, camera),
    b = await projectPoint(to, camera);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.movingCount === '2',
  );
}
async function northCamera() {
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  await page.getByRole('button', { name: '北窓側から見る', exact: true }).click();
  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector('.mini-map svg').dataset.cameraZ) - 1800) < 2,
  );
  const camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(seed.building.mainWidth / 2000, 1.6, 1.8);
  camera.lookAt(seed.building.mainWidth / 2000, 1.6, 20);
  return camera;
}

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await waitProject(page, (p) => p.artworks.length >= 4);
  await put();
  await select();
  await beginPlan(100, 10000, 100, 13000);
  let pending = await preview();
  assert.equal(pending.count, 2);
  assert.equal(pending.valid, true);
  assert.equal(await page.locator('.plan-panel .plan-placement-preview').count(), 2);
  assert.equal(await page.locator('.plan-panel .plan-art[opacity="0.15"]').count(), 2);
  await unchanged();
  await page.mouse.up();
  let saved = await waitPlacements((p) => p[0].s === 13000);
  verifyGroup(saved, 'west');
  assert.equal(saved[0].bottom, original[0].bottom);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitPlacements((p) => p[0].s === 10000 && p[1].s === 12000);
  assert.equal(
    await page.getByRole('button', { name: '元に戻す', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitPlacements((p) => p[0].s === 13000 && p[1].s === 15000);
  checked('plan: selection retained, all previews, no preview saves, one-step undo/redo');

  await beginPlan(100, 13000, seed.building.mainWidth - 100, 24000);
  pending = await preview();
  assert.equal(pending.valid, true);
  assert.equal(pending.wallId, 'east');
  await page.mouse.up();
  saved = await waitPlacements((p) => p[0].wallId === 'east');
  verifyGroup(saved, 'east', -1);
  const crossWall = structuredClone(saved);
  await page.reload({ waitUntil: 'networkidle' });
  await unchanged(crossWall);
  checked('plan: whole group transfers to another wall, preserves front-facing order and persists');

  const blocked = structuredClone(seed);
  Object.assign(ps(blocked)[3], { s: 15750, bottom: 1450 });
  await put(blocked);
  await select();
  await beginPlan(100, 10000, seed.building.mainWidth - 100, 24000);
  pending = await preview();
  assert.equal(pending.valid, false);
  assert.equal(pending.count, 2);
  await page.locator('.drag-feedback.invalid').filter({ hasText: '重なります' }).waitFor();
  await page.screenshot({ path: `${output}/collision-preview.png`, fullPage: true });
  await page.mouse.up();
  await unchanged(ps(blocked));
  assert.equal(
    await page.getByRole('button', { name: '元に戻す', exact: true }).isDisabled(),
    true,
  );
  checked('plan: collision by a non-anchor work rejects every work and creates no history');

  await put();
  await select();
  await beginPlan(100, 10000, 100, 14000);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await unchanged();
  assert.equal((await preview()).moving, 0);
  await select();
  await beginPlan(100, 10000, 100, 14000);
  await page
    .locator('.plan-panel [data-placement-id="p-1"]')
    .dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await unchanged();
  assert.equal(
    await page.getByRole('button', { name: '元に戻す', exact: true }).isDisabled(),
    true,
  );
  checked('plan: Escape and pointer cancellation restore every original work');

  await select(['p-1', 'p-4']);
  await pointOnPlan(page, 100, 10000);
  await page.mouse.down();
  await pointOnPlan(page, 100, 15000);
  await page.locator('.drag-feedback.invalid').filter({ hasText: '同じ壁面' }).waitFor();
  await page.mouse.up();
  await unchanged();
  checked('plan: mixed-wall source selection is rejected with an explanation');

  await put();
  await select();
  let camera = await northCamera();
  await begin3D(
    { x: 0.044, y: 1.45, z: 10 },
    { x: seed.building.mainWidth / 1000, y: 2.0, z: 10 },
    camera,
  );
  pending = await preview();
  assert.equal(pending.wallId, 'east');
  assert.equal(pending.valid, true);
  assert.equal(pending.count, 2);
  await unchanged();
  await page.screenshot({ path: `${output}/3d-group-preview.png`, fullPage: true });
  await page.mouse.up();
  saved = await waitPlacements((p) => p[0].wallId === 'east');
  verifyGroup(saved, 'east', -1);
  assert.equal(saved[0].bottom, pending.bottom);
  assert.ok(
    saved[0].bottom > original[0].bottom + 400,
    '3D drag must change height for the entire group',
  );
  checked('3D: cross-wall drag shows every member and preserves horizontal/vertical offsets');

  const beforeCancel = structuredClone(saved);
  await begin3D(
    {
      x: seed.building.mainWidth / 1000 - 0.044,
      y: (saved[0].bottom + 550) / 1000,
      z: (saved[0].s + 6250) / 1000,
    },
    { x: 0, y: 2.2, z: 15 },
    camera,
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await unchanged(beforeCancel);
  checked('3D: Escape cancels a cross-wall group preview without saving');

  await put();
  await select();
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.getByRole('button', { name: '＋ 可動壁を追加', exact: true }).click();
  let project = await waitProject(page, (p) => p.layouts[0].partitions.length === 1);
  const part = project.layouts[0].partitions[0],
    rail = project.rails.find((r) => r.id === part.railId);
  // Adding a partition selects it; select the works again before dragging.
  await select();
  await beginPlan(100, 10000, part.s, rail.z1 - 120);
  pending = await preview();
  assert.equal(pending.valid, true);
  assert.ok(pending.wallId.endsWith(':front'));
  await page.mouse.up();
  saved = await waitPlacements((p) => p[0].wallId.endsWith(':front'));
  verifyGroup(saved, `partition:${part.id}:front`);
  const front = walls(project.building, project.layouts[0].partitions, project.rails).find(
    (w) => w.id === saved[0].wallId,
  );
  await beginPlan(
    front.start.x + front.tangent.x * saved[0].s + front.normal.x * 120,
    front.start.z + front.tangent.z * saved[0].s + front.normal.z * 120,
    part.s,
    rail.z1 + 120,
  );
  pending = await preview();
  assert.equal(pending.valid, true);
  assert.ok(pending.wallId.endsWith(':back'));
  await page.mouse.up();
  saved = await waitPlacements((p) => p[0].wallId.endsWith(':back'));
  verifyGroup(saved, `partition:${part.id}:back`, -1);
  checked('plan: whole group transfers to movable wall front and back faces');

  assert.deepEqual(errors, []);
  const report = { status: 'passed', checks, browserErrors: errors };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { status: 'failed', checks, error: error.message, browserErrors: errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
