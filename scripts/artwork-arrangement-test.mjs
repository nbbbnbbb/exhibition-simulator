import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createProject } from '../src/domain.js';
import { storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(20000);
// Serve the production build inside Playwright so the test needs no local
// listener and cannot accidentally connect to a different development server.
if (!process.env.MA_TEST_URL) {
  const root = path.resolve('dist');
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
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
}
const errors = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('crash', () => console.error('Browser page crashed'));
const output = 'test-results/artwork-arrangement';
await fs.mkdir(output, { recursive: true });
const panel = page.locator('.artwork-arrangement');
const ps = (p) => p.layouts[0].placements;
const heights = [1100, 900, 1000],
  widths = [900, 700, 1200];
const centre = (p, i) => p.bottom + heights[i] / 2;
const saved = async () => ps(await storedProject(page));
const seed = createProject();
seed.name = '整列・均等・行列のブラウザー検証';
ps(seed)
  .slice(0, 3)
  .forEach((p, i) => {
    p.bottom = [100, 1500, 3500][i];
  });
const original = structuredClone(ps(seed));

async function put(project) {
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
}
async function select(ids = ['p-1', 'p-2', 'p-3']) {
  await page.getByRole('button', { name: '平面', exact: true }).click();
  for (const [i, id] of ids.entries())
    await page
      .locator(`.plan-panel [data-placement-id="${id}"] line`)
      .last()
      .click({
        force: true,
        modifiers: i ? ['Shift'] : [],
      });
  await panel.waitFor();
}
async function undoToOriginal() {
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitProject(page, (p) => JSON.stringify(ps(p)) === JSON.stringify(original));
}
async function setNumber(label, value) {
  const input = panel.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}
async function expectSaved(predicate) {
  const p = await waitProject(page, (p) => predicate(ps(p)));
  assert.deepEqual(ps(p)[3], original[3], 'unselected work must be unchanged');
  return ps(p);
}

try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  await waitProject(page, (p) => p.artworks.length >= 4);
  await put(seed);
  console.log('Loaded the production build and isolated test project');
  await select(['p-1']);
  assert.equal(
    await panel.getByRole('button', { name: '上端を揃える', exact: true }).isDisabled(),
    true,
  );
  await select();
  for (const [label, predicate] of [
    ['上端', (p) => p.slice(0, 3).every((q, i) => q.bottom + heights[i] === 4500)],
    ['上下中央', (p) => p.slice(0, 3).every((q, i) => centre(q, i) === 2300)],
    ['下端', (p) => p.slice(0, 3).every((q) => q.bottom === 100)],
    // On the west wall, increasing s goes left when viewed from the front.
    ['左端', (p) => p.slice(0, 3).every((q, i) => q.s + widths[i] / 2 === 11800)],
    ['左右中央', (p) => p.slice(0, 3).every((q) => q.s === 8675)],
    ['右端', (p) => p.slice(0, 3).every((q, i) => q.s - widths[i] / 2 === 5550)],
  ]) {
    await panel.getByRole('button', { name: `${label}を揃える`, exact: true }).click();
    await expectSaved(predicate);
    await undoToOriginal();
    console.log(`Alignment passed: ${label}`);
  }
  checks.push(
    'all six alignment buttons, front-facing left/right, selection scope and one-step undo',
  );

  await panel.getByRole('button', { name: '両端を固定して等間隔', exact: true }).click();
  await expectSaved((p) => p[0].s === 6000 && p[2].s === 11200 && p[1].s === 8525);
  await undoToOriginal();
  await setNumber('作品間のすき間', 250);
  await panel.getByRole('button', { name: '適用', exact: true }).click();
  await expectSaved((p) => p[2].s === 11200 && p[1].s === 10000 && p[0].s === 8950);
  await undoToOriginal();
  await panel.getByRole('button', { name: '縦方向', exact: true }).click();
  await panel.getByRole('button', { name: '両端を固定して等間隔', exact: true }).click();
  await expectSaved((p) => p[0].bottom === 100 && p[1].bottom === 1900 && p[2].bottom === 3500);
  await undoToOriginal();
  await panel.getByRole('button', { name: '適用', exact: true }).click();
  await expectSaved((p) => p[0].bottom === 1000 && p[1].bottom === 2350 && p[2].bottom === 3500);
  await undoToOriginal();
  checks.push('horizontal/vertical distribution with both fixed endpoints and fixed edge gaps');

  await panel.locator('summary').click();
  await setNumber('列数', 2);
  await setNumber('列のすき間', 300);
  await setNumber('行のすき間', 250);
  await panel.getByRole('button', { name: '行列配置を適用', exact: true }).click();
  const grid = await expectSaved(
    (p) =>
      p[0].s === p[2].s &&
      p[0].s - p[1].s === 1250 &&
      centre(p[0], 0) === centre(p[1], 1) &&
      centre(p[0], 0) - centre(p[2], 2) === 1300,
  );
  await undoToOriginal();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await waitProject(page, (p) => JSON.stringify(ps(p)) === JSON.stringify(grid));
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/arrangement-controls.png`, fullPage: true });
  // Check the controls at a smaller desktop viewport as well.
  await page.setViewportSize({ width: 1280, height: 800 });
  await panel.locator('summary').scrollIntoViewIfNeeded();
  for (const label of ['列数', '列のすき間', '行のすき間']) {
    const inputBox = await panel
      .getByRole('spinbutton', { name: label, exact: true })
      .boundingBox();
    const inspectorBox = await page.locator('.inspector').boundingBox();
    assert.ok(
      inputBox.x >= inspectorBox.x &&
        inputBox.x + inputBox.width <= inspectorBox.x + inspectorBox.width,
    );
  }
  await page.screenshot({ path: `${output}/compact-controls.png`, fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await saved(), grid);
  checks.push(
    '2-column grid with incomplete last row, per-axis gaps, undo/redo, persistence and compact layout',
  );

  await put(seed);
  await select(['p-1']);
  await panel.getByRole('button', { name: '両端を固定して等間隔', exact: true }).click();
  await expectSaved((p) => p[1].s === 8525);
  checks.push('single-selection distribution still targets all works on that wall');

  await put(seed);
  await select(['p-1', 'p-4']);
  await panel.getByRole('button', { name: '上端を揃える', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '同じ壁面' }).waitFor();
  assert.deepEqual(await saved(), original);
  assert.equal(
    await page.getByRole('button', { name: '元に戻す', exact: true }).isDisabled(),
    true,
  );
  checks.push('mixed-wall selection rejected without changing saved data or history');

  await put(seed);
  await select();
  await panel.locator('summary').click();
  await setNumber('列数', 1);
  await setNumber('行のすき間', 20000);
  await panel.getByRole('button', { name: '行列配置を適用', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '収まりません' }).waitFor();
  assert.deepEqual(await saved(), original);
  assert.equal(
    await page.getByRole('button', { name: '元に戻す', exact: true }).isDisabled(),
    true,
  );
  checks.push('oversized grid rejected atomically without a history entry');

  const collision = structuredClone(seed);
  ps(collision)
    .slice(0, 3)
    .forEach((p, i) => {
      p.bottom = [950, 1050, 1000][i];
    });
  await put(collision);
  await select();
  await panel.getByRole('button', { name: '左右中央を揃える', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '重なります' }).waitFor();
  assert.deepEqual(await saved(), ps(collision));
  assert.equal(
    await page.getByRole('button', { name: '元に戻す', exact: true }).isDisabled(),
    true,
  );
  checks.push('alignment collision rejected without changing data or history');
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
