import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(45000);
const output = 'test-results/partition-placement',
  root = path.resolve('dist');
await fs.mkdir(output, { recursive: true });
const errors = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
// Use a separate browser profile and the local build; leave the user's saved plans alone.
if (!process.env.MA_TEST_URL)
  await page.route('http://127.0.0.1:5173/**', async (route) => {
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
const parts = (p) => p.layouts.find((l) => l.id === p.activeLayoutId).partitions;
const host = page.locator('.scene-host');
const start = () => page.getByRole('button', { name: '＋ 可動壁を追加', exact: true }).click();
const check = (message) => {
  checks.push(message);
  console.log(message);
};
const preview = () =>
  host.evaluate((el) => ({
    railId: el.dataset.partitionPreviewRail,
    s: Number(el.dataset.partitionPreviewS),
    valid: el.dataset.partitionPreviewValid === 'true',
  }));
const undo = () => page.getByRole('button', { name: '元に戻す', exact: true }).click();
async function at3D(project, x, z, click = false) {
  const rect = await page.locator('canvas').boundingBox();
  const b = project.building;
  const camera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.03, 250);
  camera.position.set(b.mainWidth / 1000 + 22, 29, b.length / 1000 + 13);
  camera.lookAt((b.mainWidth - b.overallWidth) / 4000, 0, b.length / 2000);
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(x / 1000, 0, z / 1000).project(camera);
  const screen = {
    x: rect.x + ((p.x + 1) * rect.width) / 2,
    y: rect.y + ((1 - p.y) * rect.height) / 2,
  };
  await page.mouse.move(screen.x, screen.y);
  if (click) await page.mouse.click(screen.x, screen.y);
}
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  const project = await waitProject(page, (p) => !!p.rails);
  const rail = project.rails.find((r) => r.id === 'rail-cross-3');
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const floorToggle = page
    .locator('.bottom-controls')
    .getByRole('checkbox', { name: '可動壁の床ライン', exact: true });
  await floorToggle.uncheck();
  assert.equal(await page.locator('.partition-floor-line').count(), 0);
  await start();
  assert.equal(await page.locator('.partition-floor-line').count(), project.rails.length);
  await pointOnPlan(page, 3304, rail.z1);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.partitionPreviewValid === 'true',
  );
  let pending = await preview();
  assert.equal(pending.railId, rail.id);
  assert.equal(pending.s, 3300);
  assert.equal(await page.locator('.plan-partition-preview').count(), 1);
  await page.waitForTimeout(600);
  assert.equal(parts(await storedProject(page)).length, 0, 'hover must not save a wall');
  await page.screenshot({ path: `${output}/plan-preview.png`, fullPage: true });
  await pointOnPlan(page, 3304, rail.z1, true);
  let saved = await waitProject(page, (p) => parts(p).length === 1);
  assert.equal(parts(saved)[0].s, pending.s);
  assert.equal(parts(saved)[0].railId, pending.railId);
  assert.equal(await page.locator('.partition-floor-line').count(), 0);
  assert.equal(await floorToggle.isChecked(), false);
  assert.equal(await page.getByTestId('partition-width').inputValue(), '3000');
  await undo();
  await waitProject(page, (p) => parts(p).length === 0);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitProject(page, (p) => parts(p).length === 1);
  check(
    'plan: hover preview only, click saves exact position once, temporary floor guides, single undo/redo',
  );

  await start();
  await pointOnPlan(page, 100, rail.z1);
  assert.equal((await preview()).s, 1500);
  await pointOnPlan(page, -7000, 20000, true);
  assert.equal((await preview()).valid, false);
  assert.equal(await page.locator('.plan-partition-preview').count(), 0);
  assert.equal(parts(await storedProject(page)).length, 1);
  const vertical = project.rails.find((r) => r.id === 'rail-centre');
  await pointOnPlan(page, vertical.x1, 20000);
  pending = await preview();
  assert.equal(pending.railId, vertical.id);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.partition-placement-banner').count(), 0);
  assert.equal(await page.locator('.plan-partition-preview').count(), 0);
  check(
    'plan: auto-select vertical rail, fit wall at endpoint, reject off-line click, Escape cancels',
  );

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await start();
  await at3D(project, 5700, rail.z1);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.partitionPreviewValid === 'true',
  );
  pending = await preview();
  assert.equal(pending.railId, rail.id);
  assert.equal(pending.s, 5700);
  assert.equal(parts(await storedProject(page)).length, 1);
  await page.screenshot({ path: `${output}/3d-preview.png`, fullPage: true });
  await at3D(project, 5700, rail.z1, true);
  saved = await waitProject(page, (p) => parts(p).length === 2);
  assert.equal(parts(saved)[1].s, pending.s);
  assert.equal(parts(saved)[1].railId, rail.id);
  assert.equal(await host.getAttribute('data-placing-partition'), 'false');
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (p) => parts(p).length === 2);
  assert.equal(await host.getAttribute('data-placing-partition'), 'false');
  check('3D: floor-line hover preview, exact click commit, persistence after reload');

  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await start();
  await pointOnPlan(page, 4200, rail.z1);
  await page.getByRole('button', { name: '追加を中止', exact: true }).click();
  assert.equal(await page.locator('.plan-partition-preview').count(), 0);
  await start();
  await page.getByRole('button', { name: /^作品 \d/ }).click();
  await page.locator('.partition-placement-banner').waitFor({ state: 'hidden' });
  check('cancel button and library switch clean up the preview');

  const invalid = structuredClone(saved);
  invalid.name = '低い天井の配置検証';
  invalid.layouts.forEach((l) => {
    l.partitions = [];
  });
  invalid.building.height = 4500;
  await page.locator('input[type=file][accept=".json"]').setInputFiles({
    name: 'low-ceiling.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await waitProject(page, (p) => p.name === invalid.name);
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await start();
  await pointOnPlan(page, 4200, rail.z1, true);
  assert.equal((await preview()).valid, false);
  assert.equal(await page.locator('.plan-partition-preview').count(), 1);
  assert.equal(parts(await storedProject(page)).length, 0);
  await page.screenshot({ path: `${output}/invalid-preview.png`, fullPage: true });
  await page.keyboard.press('Escape');
  check('invalid height: red preview, click cannot save a wall');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
