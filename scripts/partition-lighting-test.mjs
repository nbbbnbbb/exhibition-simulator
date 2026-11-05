import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { addPartitionOnPlan } from './placement-test-helpers.mjs';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const assert = (v, m) => {
  if (!v) throw new Error(m);
};
const toggle = () =>
  page.locator('.bottom-controls').getByRole('checkbox', { name: '可動壁の床ライン', exact: true });
const lighting = () =>
  page.locator('.inspector-tabs').getByRole('button', { name: '照明・日照', exact: true }).click();
const placement = () =>
  page.locator('.inspector-tabs').getByRole('button', { name: '配置の詳細', exact: true }).click();
async function settle() {
  await page.waitForTimeout(150);
  await page.locator('.save-status').filter({ hasText: '保存済み' }).waitFor();
  await page.waitForTimeout(250);
}
async function field(name, value) {
  const el = page.getByRole('spinbutton', { name, exact: true });
  await el.fill(String(value));
  await el.press('Tab');
  await settle();
}
async function sample() {
  return page.evaluate(() => {
    const source = document.querySelector('canvas'),
      c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const p = ctx.getImageData(
      c.width * 0.46,
      c.height * 0.46,
      c.width * 0.08,
      c.height * 0.08,
    ).data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4)
      sum += p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722;
    return sum / (p.length / 4);
  });
}
await fs.mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await toggle().waitFor();
  await settle();
  assert(await toggle().isChecked(), 'floor line default');
  assert(
    (await page.locator('.plan-panel .partition-floor-line').count()) === 13,
    'plan line count',
  );
  await toggle().uncheck();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.floorLines === 'false',
  );
  assert(
    (await page.locator('.plan-panel .partition-floor-line').count()) === 0,
    'plan lines remain visible',
  );
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  assert(
    !(await page
      .locator('.partitions-library')
      .getByRole('checkbox', { name: '可動壁の床ライン', exact: true })
      .isChecked()),
    'two controls are not linked',
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert(!(await toggle().isChecked()), 'floor line preference did not persist');
  await toggle().check();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.floorLineCount === '13',
  );
  assert(
    (await page.locator('.plan-panel .partition-floor-line').count()) === 13,
    'floor lines did not reappear',
  );
  await toggle().uncheck();
  await lighting();
  await page.getByRole('button', { name: '自然光のみ', exact: true }).click();
  await page.getByLabel('日照の日付', { exact: true }).fill('2026-12-22');
  await page.getByLabel('日照の時刻', { exact: true }).fill('12:00');
  await field('屋外の天空光', 0);
  await field('床・壁の反射光', 0);
  await page.getByText('敷地の遮蔽条件を調整（推定）', { exact: true }).click();
  await field('南側の遮蔽高度', 0);
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await addPartitionOnPlan(page, 'rail-south-cross');
  await placement();
  await page.getByRole('button', { name: '歩く', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await settle();
  await page.locator('canvas').focus();
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(950);
  await page.keyboard.up('KeyS');
  const bounds = await page.locator('canvas').boundingBox(),
    x = bounds.x + bounds.width / 2,
    y = bounds.y + 70;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 500, { steps: 12 });
  await page.mouse.up();
  await settle();
  const cameraZ = Number(await page.locator('.mini-map svg').getAttribute('data-camera-z'));
  assert(cameraZ > 37350 && cameraZ < 37520, `camera near wall: ${cameraZ}`);
  const blocked = await sample();
  await page.screenshot({ path: 'test-results/partition-direct-blocked.png', fullPage: true });
  await field('ライン起点から壁中心', 1500);
  const moved = await sample();
  assert(
    moved > blocked + 40,
    `partition did not block direct sunlight ${JSON.stringify({ blocked, moved })}`,
  );
  await page.screenshot({ path: 'test-results/partition-direct-moved.png', fullPage: true });
  await field('ライン起点から壁中心', 4793);
  const blockedAgain = await sample();
  assert(blockedAgain < moved * 0.3 + 3, 'partition shadow did not update after moving back');
  await toggle().check();
  await page.waitForTimeout(300);
  const linesOn = await sample();
  assert(Math.abs(linesOn - blockedAgain) < 3, 'floor lines changed the wall shadow');
  await toggle().uncheck();
  await lighting();
  await field('太陽光の強度', 0);
  await field('屋外の天空光', 12000);
  const skyBlocked = await sample();
  await placement();
  await field('ライン起点から壁中心', 1500);
  const skyMoved = await sample();
  assert(
    skyMoved > skyBlocked + 8,
    `partition did not attenuate window scatter ${JSON.stringify({ skyBlocked, skyMoved })}`,
  );
  await page.screenshot({ path: 'test-results/partition-sky-moved.png', fullPage: true });
  assert(errors.length === 0, 'WebGL errors: ' + errors.join('; '));
  const result = {
    status: 'passed',
    checks: [
      'floor lines toggle in 3D and plan',
      'linked controls',
      'visibility preference persists',
      'movable wall blocks direct sunlight (actual pixels)',
      'moving wall updates shadow',
      'hidden floor lines preserve wall occlusion',
      'movable wall attenuates diffuse window light (actual pixels)',
    ],
    cameraZ,
    pixels: { blocked, moved, blockedAgain, linesOn, skyBlocked, skyMoved },
    browserErrors: errors,
  };
  await fs.writeFile(
    'test-results/partition-lighting-report.json',
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  await page
    .screenshot({ path: 'test-results/partition-lighting-failure.png', fullPage: true })
    .catch(() => {});
  throw err;
} finally {
  await browser.close();
}
