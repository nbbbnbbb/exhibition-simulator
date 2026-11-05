import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createProject, walls, positionOnWall } from '../src/domain.js';
import {
  addPartitionOnPlan,
  pointOnPlan,
  storedProject,
  waitProject,
} from './placement-test-helpers.mjs';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(25000);
const errors = [],
  checks = [],
  depthSamples = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const output = 'test-results/artwork-move';
await fs.mkdir(output, { recursive: true });
const put = async (project) => {
  await page.evaluate(
    (data) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('ma-exhibition-v1', 1);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').put(data, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    project,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (p) => p.name === project.name);
};
const activeP = (p) =>
  p.layouts.find((l) => l.id === p.activeLayoutId).placements.find((p) => p.id === 'p-1');
const preview = () =>
  page.locator('.scene-host').evaluate((el) => ({
    wallId: el.dataset.previewWall,
    s: +el.dataset.previewS,
    bottom: +el.dataset.previewBottom,
    valid: el.dataset.previewValid === 'true',
  }));
const projectPoint = async (point, cam) => {
  const box = await page.locator('canvas').boundingBox();
  cam.aspect = box.width / box.height;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const v = new THREE.Vector3(point.x, point.y, point.z).project(cam);
  return { x: box.x + ((v.x + 1) * box.width) / 2, y: box.y + ((1 - v.y) * box.height) / 2 };
};
const drag3D = async (from, to, cam) => {
  const a = await projectPoint(from, cam),
    z = await projectPoint(to, cam);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(z.x, z.y, { steps: 8 });
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.movingPlacement === 'p-1',
  );
};
const selectP1 = () =>
  page.locator('.plan-panel .plan-art[data-placement-id="p-1"] line').last().click({ force: true });
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await waitProject(page, (p) => p.artworks.length === 20);
  const p = createProject();
  p.name = '壁面間ドラッグ検証';
  p.layouts[0].placements[0].s = 10000;
  p.layouts[0].placements[1].s = 14000;
  p.layouts[0].placements[2].s = 18000;
  await put(p);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  await page.getByRole('button', { name: '北窓側から見る', exact: true }).click();
  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector('.mini-map svg').dataset.cameraZ) - 1800) < 2,
  );
  const cam = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  cam.position.set(p.building.mainWidth / 2000, 1.6, 1.8);
  cam.lookAt(p.building.mainWidth / 2000, 1.6, 20);
  await drag3D({ x: 0.044, y: 1.5, z: 10 }, { x: p.building.mainWidth / 1000, y: 1.5, z: 10 }, cam);
  let destination = await preview();
  assert.equal(destination.wallId, 'east');
  assert.equal(destination.valid, true);
  assert.equal(activeP(await storedProject(page)).wallId, 'west', 'drag preview must not save');
  await page.screenshot({ path: `${output}/3d-wall-preview.png`, fullPage: true });
  await page.mouse.up();
  let saved = await waitProject(page, (p) => activeP(p).wallId === 'east');
  assert.equal(activeP(saved).s, destination.s);
  assert.equal(activeP(saved).bottom, destination.bottom);
  assert.equal(saved.layouts[0].placements.length, 4);
  assert.equal(saved.artworks[0].quantity, 1);
  checks.push('3D wall-to-wall preview, single commit, unchanged inventory and ID');
  let moved = activeP(saved),
    art = saved.artworks[0],
    wall = walls(saved.building).find((w) => w.id === moved.wallId);
  const pos = positionOnWall(wall, moved.s, moved.bottom, art);
  await drag3D(
    { x: (pos.x + wall.normal.x * (art.depth / 2 + 1)) / 1000, y: pos.y / 1000, z: pos.z / 1000 },
    { x: 0, y: 1.5, z: 14 },
    cam,
  );
  assert.equal((await preview()).valid, false);
  await page.screenshot({ path: `${output}/overlap-preview.png`, fullPage: true });
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.deepEqual(activeP(await storedProject(page)), moved);
  checks.push('3D overlap drop rejected and original placement restored');
  await drag3D(
    { x: (pos.x + wall.normal.x * (art.depth / 2 + 1)) / 1000, y: pos.y / 1000, z: pos.z / 1000 },
    { x: 0, y: 1.5, z: 22 },
    cam,
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.deepEqual(activeP(await storedProject(page)), moved);
  checks.push('Escape cancels a wall-to-wall drag without a history entry');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const startX = saved.building.mainWidth - 100,
    startZ = wall.start.z + moved.s;
  await pointOnPlan(page, startX, startZ);
  await page.mouse.down();
  await pointOnPlan(page, 100, 24000);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewWall === 'west',
  );
  assert.equal((await preview()).valid, true);
  await page.mouse.up();
  saved = await waitProject(page, (p) => activeP(p).wallId === 'west' && activeP(p).s === 24000);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitProject(page, (p) => activeP(p).wallId === 'east');
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitProject(page, (p) => activeP(p).wallId === 'west');
  checks.push('plan wall-to-wall drag and one-step undo/redo');
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await addPartitionOnPlan(page);
  saved = await waitProject(page, (p) => p.layouts[0].partitions.length === 1);
  const part = saved.layouts[0].partitions[0],
    rail = saved.rails.find((r) => r.id === part.railId);
  await pointOnPlan(page, 100, 24000);
  await page.mouse.down();
  await pointOnPlan(page, part.s, rail.z1 - 120);
  await page.waitForFunction(
    (id) => document.querySelector('.scene-host').dataset.previewWall === `partition:${id}:front`,
    part.id,
  );
  await page.mouse.up();
  await waitProject(page, (p) => activeP(p).wallId.endsWith(':front'));
  await pointOnPlan(page, part.s, rail.z1 - 200);
  await page.mouse.down();
  await pointOnPlan(page, part.s, rail.z1 + 200);
  await page.waitForFunction(
    (id) => document.querySelector('.scene-host').dataset.previewWall === `partition:${id}:back`,
    part.id,
  );
  await page.mouse.up();
  await waitProject(page, (p) => activeP(p).wallId.endsWith(':back'));
  await page.reload({ waitUntil: 'networkidle' });
  saved = await storedProject(page);
  assert.equal(activeP(saved).wallId, `partition:${part.id}:back`);
  assert.equal(saved.layouts[0].placements.length, 4);
  checks.push('movable wall front/back transfer and IndexedDB persistence');
  // A 1mm-thick diagnostic artwork exercises the original depth precision issue.
  const depth = createProject();
  depth.name = '遠景の奥行き検証';
  depth.artworks[0] = {
    ...depth.artworks[0],
    width: 3000,
    height: 3000,
    depth: 1,
    image: await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#f000ed';
      x.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png');
    }),
  };
  depth.layouts[0].placements = [
    { id: 'p-1', artworkId: 'art-1', wallId: 'west', s: 18000, bottom: 800 },
  ];
  await put(depth);
  await selectP1();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  assert.equal(
    await page.locator('.scene-host').getAttribute('data-depth-precision'),
    'adaptive-near',
  );
  const cameraX = () => page.locator('.mini-map svg').getAttribute('data-camera-x').then(Number);
  await page.waitForFunction(
    () => Number(document.querySelector('.mini-map svg').dataset.cameraX) < 7000,
  );
  const measure = async () => {
    const box = await page.locator('canvas').boundingBox(),
      x = (await cameraX()) / 1000;
    const radius = (x - 0.0085) / Math.cos(Math.PI * 0.02);
    const camera = new THREE.PerspectiveCamera(50, box.width / box.height, 0.03, 250);
    camera.position.set(x, 2.3 + radius * Math.sin(Math.PI * 0.02), 18);
    camera.lookAt(0.0085, 2.3, 18);
    camera.updateMatrixWorld();
    const points = [];
    for (let row = 0; row < 9; row++)
      for (let column = 0; column < 9; column++) {
        const v = new THREE.Vector3(0.01, 2.3 + (row - 4) * 0.3, 18 + (column - 4) * 0.3).project(
          camera,
        );
        points.push({ x: (v.x + 1) / 2, y: (1 - v.y) / 2 });
      }
    const fraction = await page.locator('canvas').evaluate((canvas, points) => {
      const gl = canvas.getContext('webgl2'),
        pixel = new Uint8Array(4);
      let painted = 0;
      for (const p of points) {
        gl.readPixels(
          Math.floor(p.x * canvas.width),
          Math.floor((1 - p.y) * canvas.height),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        if (
          pixel[0] > 35 &&
          pixel[2] > 20 &&
          pixel[0] > pixel[1] * 1.5 &&
          pixel[2] > pixel[1] * 1.5
        )
          painted++;
      }
      return painted / points.length;
    }, points);
    return { radius, fraction };
  };
  for (const radius of [6, 30, 70, 99, 98.9, 99.1]) {
    const x = await cameraX(),
      current = (x / 1000 - 0.0085) / Math.cos(Math.PI * 0.02);
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, Math.log(radius / current) / (-Math.log(0.95) * 0.01));
    await page.waitForFunction(
      (radius) =>
        Math.abs(
          (Number(document.querySelector('.mini-map svg').dataset.cameraX) / 1000 - 0.0085) /
            Math.cos(Math.PI * 0.02) -
            radius,
        ) < 0.15,
      radius,
    );
    await page.waitForTimeout(350);
    const sample = await measure();
    depthSamples.push(sample);
    assert(
      sample.fraction >= 0.95,
      `artwork surface lost at ${sample.radius}m: ${sample.fraction}`,
    );
  }
  await page.screenshot({ path: `${output}/zoomed-out.png`, fullPage: true });
  checks.push(
    '1mm artwork face remains visible from 6m to 99m during small zoom changes (actual pixels)',
  );
  // An opaque wall in front must still occlude the artwork; depth testing stays on.
  depth.rails.push({
    id: 'occlusion-rail',
    name: '遮蔽テスト',
    x1: 2000,
    z1: 16500,
    x2: 2000,
    z2: 19500,
  });
  depth.layouts[0].partitions.push({
    id: 'blocker',
    name: '遮蔽壁',
    railId: 'occlusion-rail',
    s: 1500,
    width: 3000,
    height: 5000,
    thickness: 200,
  });
  await put(depth);
  await selectP1();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('.mini-map svg').dataset.cameraX) < 7000,
  );
  await page.waitForTimeout(400);
  const occluded = await measure();
  assert(occluded.fraction < 0.05, 'artwork incorrectly draws through a nearer opaque wall');
  checks.push('opaque nearer wall still hides the artwork (actual pixels)');
  assert.deepEqual(errors, []);
  const result = { status: 'passed', checks, depthSamples, occluded, browserErrors: errors };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { status: 'failed', checks, depthSamples, error: err.message, browserErrors: errors },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw err;
} finally {
  await browser.close();
}
