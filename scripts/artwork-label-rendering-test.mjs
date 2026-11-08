import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createProject } from '../src/domain.js';
import { pointOnPlan, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 0.75,
});
page.setDefaultTimeout(45000);
const root = path.resolve('dist');
const url = process.env.MA_TEST_URL || 'http://127.0.0.1:5173/';
const output = process.env.MA_TEST_URL
  ? 'test-results/artwork-label-rendering-public'
  : 'test-results/artwork-label-rendering';
const errors = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
if (!process.env.MA_TEST_URL)
  await page.route('http://127.0.0.1:5173/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403 });
    await route.fulfill({ path: file });
  });
await page.addInitScript(() => {
  const stats = (window.labelRenderingStats = { draws: 0, uploads: 0, textures: new Set() });
  const gl = WebGL2RenderingContext.prototype;
  for (const name of [
    'drawArrays',
    'drawElements',
    'drawArraysInstanced',
    'drawElementsInstanced',
    'bufferData',
  ]) {
    const original = gl[name];
    gl[name] = function (...args) {
      stats[name === 'bufferData' ? 'uploads' : 'draws']++;
      return original.apply(this, args);
    };
  }
  const ctx = CanvasRenderingContext2D.prototype;
  const strokeText = ctx.strokeText;
  ctx.strokeText = function (...args) {
    stats.textures.add(this.canvas);
    return strokeText.apply(this, args);
  };
});
const button = (name) => page.getByRole('button', { name, exact: true });
const labels = page.getByRole('checkbox', { name: '作品情報を表示', exact: true });
const canvas = page.getByTestId('three-canvas');
const labelCount = (count) =>
  page.waitForFunction(
    (expected) =>
      Number(document.querySelector('.scene-host')?.dataset.artworkLabelCount) === expected,
    count,
  );
const stats = () =>
  page.evaluate(() => {
    const { uploads, textures } = window.labelRenderingStats;
    return { uploads, textures: textures.size };
  });
const drawsPerFrame = () =>
  page.evaluate(async () => {
    const stats = window.labelRenderingStats;
    const samples = [];
    let previous = stats.draws;
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(stats.draws - previous);
      previous = stats.draws;
    }
    return samples.slice(2).sort((a, b) => a - b)[3];
  });

try {
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await page.locator('.save-status.saved').waitFor();
  await pointOnPlan(page, 105, 6000, true);
  await button('作品を正面から確認').click();
  await button('3D').click();
  await button('表示項目').click();
  await page.getByLabel('作品情報の表示位置', { exact: true }).selectOption('overlay');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '閉じる', exact: true })
    .first()
    .click();
  await drawsPerFrame();
  const withoutText = await canvas.screenshot();
  const beforeToggle = await stats();
  await labels.check();
  await labelCount(4);
  await drawsPerFrame();
  assert.equal(
    (await stats()).uploads,
    beforeToggle.uploads,
    'enabling labels rebuilt scene buffers',
  );
  const withText = await canvas.screenshot({ path: `${output}/overlay.png` });
  assert.ok(!withoutText.equals(withText), 'the overlay must change rendered pixels');
  const coverage = await page.evaluate(() =>
    [...window.labelRenderingStats.textures].map((texture) => {
      const pixels = texture
        .getContext('2d')
        .getImageData(0, 0, texture.width, texture.height).data;
      let ink = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) ink++;
      return ink / (pixels.length / 4);
    }),
  );
  assert.equal(coverage.length, 4);
  assert.ok(
    coverage.every((ink) => ink > 0 && ink < 0.35),
    'only glyph pixels should be visible',
  );
  assert.ok(
    withText.equals(await canvas.screenshot()),
    'a stationary artwork should render consistently',
  );
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  const downloading = page.waitForEvent('download');
  await button('現在の空間をGLB保存').click();
  const glbPath = `${output}/artworks.glb`;
  await (await downloading).saveAs(glbPath);
  const bytes = await fs.readFile(glbPath);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.images.length, 4, 'GLB must include only the original artwork images');
  assert.ok(!gltf.nodes.some((node) => node.name?.startsWith('作品情報')));
  await page.getByRole('button', { name: /^作品 \d/ }).click();

  const project = createProject();
  project.name = '48点のオーバーレイ描画';
  const art = project.artworks[0];
  Object.assign(art, { width: 300, height: 240, quantity: 24 });
  project.artworks.push({ ...art, id: 'without-image', image: '' });
  project.artworkLabels.position = 'overlay';
  project.layouts[0].placements = Array.from({ length: 48 }, (_, i) => ({
    id: `work-${i}`,
    artworkId: i < 24 ? art.id : 'without-image',
    wallId: 'west',
    s: 4000 + (i % 24) * 500,
    bottom: i < 24 ? 500 : 1500,
  }));
  await page.locator('.header-actions input[type="file"]').setInputFiles({
    name: '48-works.ma.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await waitProject(page, (saved) => saved.name === project.name);
  await button('全体を表示').click();
  const offDraws = await drawsPerFrame();
  const beforeMany = await stats();
  await labels.check();
  await labelCount(48);
  const onDraws = await drawsPerFrame();
  assert.ok(offDraws > 0);
  assert.equal(onDraws, offDraws, 'overlay must not add draw calls');
  assert.equal((await stats()).uploads, beforeMany.uploads);
  assert.equal(
    (await stats()).textures - beforeMany.textures,
    1,
    'identical glyphs should share a texture',
  );
  await pointOnPlan(page, 105, 4000, true);
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).waitFor();
  await pointOnPlan(page, 105, 4500, true);
  await drawsPerFrame();
  assert.equal(
    (await stats()).textures - beforeMany.textures,
    1,
    'selection must not rasterize labels',
  );
  assert.deepEqual(errors, []);
  const report = { url, works: 48, offDraws, onDraws, labelTextures: 1, glyphCoverage: coverage };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
