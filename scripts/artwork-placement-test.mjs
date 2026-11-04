import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { pointOnPlan, placeOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(20000);
const errors = [],
  checks = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
const output = 'test-results/artwork-placement';
await fs.mkdir(output, { recursive: true });
const title = '静かな地平 / サンプル';
const add = () => page.getByRole('button', { name: `${title}を配置`, exact: true }).click();
const count = (p) =>
  p.layouts.find((l) => l.id === p.activeLayoutId).placements.filter((p) => p.artworkId === 'art-1')
    .length;
const field = async (name, value) => {
  const input = page.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
};
const settle = () => page.waitForTimeout(600);
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await waitProject(page, (p) => p.artworks[0].quantity === 1);
  assert(await page.getByRole('button', { name: `${title}を配置`, exact: true }).isDisabled());
  await page.getByRole('button', { name: `${title}を編集`, exact: true }).click();
  await field('数量（配置上限）', 3);
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  await waitProject(page, (p) => p.artworks[0].quantity === 3);
  checks.push('quantity field and unique-work addition disabled at 1/1');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await settle();
  await add();
  assert.equal(count(await storedProject(page)), 1, 'plus must not immediately add');
  let canvas = await page.locator('canvas').boundingBox();
  const center = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewWall === 'west',
  );
  assert.equal(await page.locator('.scene-host').getAttribute('data-preview-valid'), 'false');
  await page.mouse.click(center.x, center.y);
  await settle();
  assert.equal(count(await storedProject(page)), 1, 'overlapping click changed saved plan');
  checks.push('3D wall-aligned preview and overlap prevents commit');
  // Focused camera faces west at a distance of 3m from the artwork centre.
  const distance = 3 + (35 / 2 + 8) / 1000;
  const xForZ = (z, cameraZ) =>
    center.x +
    (((cameraZ - z) / 1000 / distance) * canvas.height) / (2 * Math.tan((25 * Math.PI) / 180));
  await page.mouse.move(xForZ(4600, 6000), center.y);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewValid === 'true',
  );
  await settle();
  await page.screenshot({ path: `${output}/valid-preview.png`, fullPage: true });
  const greenPixels = await page.locator('canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2'),
      pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i + 1] > 100 &&
        pixels[i + 1] > pixels[i] * 1.25 &&
        pixels[i + 1] > pixels[i + 2] * 1.2
      )
        green++;
    return green;
  });
  assert(greenPixels > 20, 'valid preview outline must stay green under the indoor exposure');
  await page.mouse.click(xForZ(4600, 6000), center.y);
  await waitProject(page, (p) => count(p) === 2);
  await page.locator('.placement-banner').waitFor({ state: 'hidden' });
  checks.push('3D click saves one previewed placement');
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await settle();
  const second = (await storedProject(page)).layouts[0].placements.at(-1);
  await add();
  await page.mouse.move(xForZ(3000, second.s), center.y);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewValid === 'true',
  );
  await page.mouse.click(xForZ(3000, second.s), center.y);
  await waitProject(page, (p) => count(p) === 3);
  assert(await page.getByRole('button', { name: `${title}を配置`, exact: true }).isDisabled());
  assert(await page.getByRole('button', { name: '追加配置', exact: true }).isDisabled());
  checks.push('quantity limit enforced on library and inspector');
  await page.getByRole('button', { name: `${title}を編集`, exact: true }).click();
  await field('数量（配置上限）', 2);
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  await page.getByText(/3点配置中です。数量2/).waitFor();
  assert.equal((await storedProject(page)).artworks[0].quantity, 3);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  checks.push('quantity cannot be reduced below placed count');
  await page.getByRole('button', { name: '配置解除', exact: true }).click();
  await waitProject(page, (p) => count(p) === 2);
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await add();
  await pointOnPlan(page, 50, 6000);
  assert.equal(await page.locator('.scene-host').getAttribute('data-preview-valid'), 'false');
  await pointOnPlan(page, 50, 19000);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewValid === 'true',
  );
  await pointOnPlan(page, 50, 19000, true);
  await waitProject(page, (p) => count(p) === 3);
  checks.push('plan preview, overlap detection, and exact wall-local placement');
  await page.getByRole('checkbox', { name: '作品情報を表示', exact: true }).check();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.artworkLabelCount === '6',
  );
  assert.equal(await page.locator('.plan-artwork-label').count(), 6);
  await page.getByRole('button', { name: '表示項目', exact: true }).click();
  await page.getByRole('button', { name: '選択を解除', exact: true }).click();
  await page.getByRole('checkbox', { name: '表示項目 作品名', exact: true }).check();
  await page.getByRole('checkbox', { name: '表示項目 数量（配置上限）', exact: true }).check();
  await page.getByRole('button', { name: '閉じる', exact: true }).first().click();
  const keys = await page
    .locator('.plan-artwork-label')
    .first()
    .locator('tspan')
    .evaluateAll((items) => items.map((el) => el.dataset.labelField));
  assert.deepEqual(keys, ['title', 'quantity']);
  await waitProject(page, (p) => p.artworkLabels.fields.join(',') === 'title,quantity');
  checks.push('3D and plan labels with selected metadata fields');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await settle();
  await page.screenshot({ path: `${output}/artwork-label.png`, fullPage: true });
  const labelsOn = await page.locator('canvas').screenshot();
  await page.getByRole('checkbox', { name: '作品情報を表示', exact: true }).uncheck();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.artworkLabelCount === '0',
  );
  await settle();
  const labelsOff = await page.locator('canvas').screenshot();
  assert(!labelsOn.equals(labelsOff), 'labels did not change actual rendered pixels');
  await page.getByRole('checkbox', { name: '作品情報を表示', exact: true }).check();
  await waitProject(page, (p) => p.artworkLabels.enabled);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.artworkLabelCount === '6',
  );
  assert.equal(count(await storedProject(page)), 3);
  assert.deepEqual((await storedProject(page)).artworkLabels.fields, ['title', 'quantity']);
  checks.push('label toggle changes real pixels; quantity and display settings persist');
  // Escape leaves the document untouched.
  await page.getByRole('button', { name: '十牛図を配置', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.placement-banner').waitFor({ state: 'hidden' });
  assert.equal((await storedProject(page)).layouts[0].placements.length, 6);
  checks.push('cancel preview without adding');
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  const model = await downloading;
  await model.saveAs(`${output}/label-exclusion.glb`);
  const binary = await fs.readFile(`${output}/label-exclusion.glb`);
  const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString('utf8'));
  assert(
    !gltf.nodes.some((node) => node.extras?.artworkLabel || node.name?.startsWith('作品情報：')),
  );
  checks.push('informational labels excluded from GLB');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.getByRole('button', { name: '＋ 可動壁を追加', exact: true }).click();
  let saved = await waitProject(page, (p) => p.layouts[0].partitions.length === 1);
  const rail = saved.rails.find((r) => r.id === 'rail-cross-3');
  const work = saved.artworks.find((a) => a.id.endsWith('-goda-gibbon'));
  await page.getByRole('button', { name: /^作品 \d/ }).click();
  await placeOnPlan(page, work.title, saved.building.mainWidth / 2, rail.z1 - 120);
  saved = await waitProject(page, (p) => p.layouts[0].placements.length === 7);
  assert.equal(
    saved.layouts[0].placements.at(-1).wallId,
    `partition:${saved.layouts[0].partitions[0].id}:front`,
  );
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.locator('.partition-card').first().click();
  await page.getByRole('button', { name: '壁を複製', exact: true }).click();
  await page.getByText(/数量1を超える追加/).waitFor();
  await settle();
  assert.equal((await storedProject(page)).layouts[0].partitions.length, 1);
  assert.equal((await storedProject(page)).layouts[0].placements.length, 7);
  assert.equal(await page.getByTestId('partition-width').inputValue(), '3000');
  checks.push('partition-copy inventory rejection is atomic and preserves selection');
  assert.deepEqual(errors, []);
  const report = { status: 'passed', checks, browserErrors: errors };
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  await fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { status: 'failed', checks, error: err.message, browserErrors: errors },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.error('browserErrors', errors);
  throw err;
} finally {
  await browser.close();
}
