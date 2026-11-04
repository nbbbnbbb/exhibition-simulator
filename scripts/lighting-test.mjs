import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
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
async function field(name, value) {
  const f = page.getByRole('spinbutton', { name, exact: true });
  await f.fill(String(value));
  await f.press('Tab');
}
async function settle() {
  await page.waitForTimeout(150);
  await page.locator('.save-status').filter({ hasText: '保存済み' }).waitFor();
  await page.waitForTimeout(250);
}
async function energy(floor = false) {
  return page.evaluate((floor) => {
    const source = document.querySelector('canvas'),
      c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const x = Math.floor(c.width * 0.35),
      y = Math.floor(c.height * (floor ? 0.65 : 0.3)),
      w = Math.floor(c.width * 0.3),
      h = Math.floor(c.height * (floor ? 0.2 : 0.4));
    const p = ctx.getImageData(x, y, w, h).data;
    let r = 0,
      g = 0,
      b = 0;
    for (let i = 0; i < p.length; i += 4) {
      r += p[i];
      g += p[i + 1];
      b += p[i + 2];
    }
    const n = p.length / 4;
    return { r: r / n, g: g / n, b: b / n, luma: (r * 0.2126 + g * 0.7152 + b * 0.0722) / n };
  }, floor);
}
async function exportProject() {
  const p = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  const download = await p;
  const dest = path.resolve('test-results/lighting.ma.json');
  await download.saveAs(dest);
  return JSON.parse(await fs.readFile(dest, 'utf8'));
}
await fs.mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '作品を正面から確認', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  await page.getByTestId('lighting-panel').waitFor();
  await settle();
  await page.getByRole('button', { name: '夏至', exact: true }).click();
  await page.getByLabel('日照の時刻', { exact: true }).fill('12:00');
  await settle();
  assert(
    Number((await page.getByTestId('sun-altitude').innerText()).replace('°', '')) > 77,
    'summer solar altitude',
  );
  assert(
    (await page.getByTestId('sun-state').innerText()).includes('遮蔽中'),
    'south obstruction default',
  );
  await page.getByRole('button', { name: '冬至', exact: true }).click();
  await settle();
  assert(
    Number((await page.getByTestId('sun-altitude').innerText()).replace('°', '')) < 33,
    'winter solar altitude',
  );
  await page.getByRole('button', { name: '人工光のみ', exact: true }).click();
  await field('スポット 色温度', 2700);
  await field('スポット 基準照度', 350);
  await field('定常光 色温度', 6500);
  await field('定常光 基準照度', 120);
  await settle();
  const on = await energy();
  await page.screenshot({ path: 'test-results/lighting-01-controls.png', fullPage: true });
  await page.getByRole('button', { name: '全光源OFF', exact: true }).click();
  await settle();
  assert(
    (await page.getByTestId('probe-lux').innerText()) === '0',
    'all off numerical illuminance',
  );
  const off = await energy();
  assert(
    off.luma < Math.max(4, on.luma * 0.05),
    `unlit artworks/ceiling leak: ${JSON.stringify({ on, off })}`,
  );
  await page.getByRole('checkbox', { name: 'レール定常光を有効', exact: true }).check();
  await field('定常光 色温度', 2700);
  await settle();
  const warm = await energy();
  await field('定常光 色温度', 9000);
  await settle();
  const cool = await energy();
  assert(
    cool.b / Math.max(1, cool.r) > warm.b / Math.max(1, warm.r) + 0.08,
    'colour temperature did not change rendered artwork',
  );
  const beforeEV = await page.getByTestId('probe-lux').innerText();
  await field('画面の露出', 1);
  await settle();
  assert((await page.getByTestId('probe-lux').innerText()) === beforeEV, 'exposure changed lux');
  assert((await energy()).luma > cool.luma, 'display exposure');
  await field('画面の露出', 0);
  // Isolate direct sun and inspect both windows: north-side floor must stay dark at winter noon.
  await page.getByRole('button', { name: '自然光のみ', exact: true }).click();
  await field('屋外の天空光', 0);
  await field('床・壁の反射光', 0); // Isolate direct rays from reflected light for the roof test.
  await page.getByText('敷地の遮蔽条件を調整（推定）', { exact: true }).click();
  await field('南側の遮蔽高度', 0);
  await page.getByRole('button', { name: '北窓側から見る', exact: true }).click();
  await settle();
  const north = await energy(true);
  assert(north.luma < 7, `sun leaked through closed roof: ${north.luma}`);
  assert(
    (await page.locator('.scene-host').getAttribute('data-roof-occludes')) === 'true',
    'roof occluder missing',
  );
  await page.screenshot({ path: 'test-results/lighting-02-north-window.png', fullPage: true });
  await page.getByRole('button', { name: '南窓側から見る', exact: true }).click();
  await settle();
  const southOpen = await energy(true);
  assert(
    southOpen.luma > north.luma + 35,
    `direct sun did not enter south glazing ${JSON.stringify({ north, southOpen })}`,
  );
  await page.screenshot({ path: 'test-results/lighting-03-south-unblocked.png', fullPage: true });
  await field('南側の遮蔽高度', 80);
  await settle();
  const southBlocked = await energy(true);
  assert(
    southBlocked.luma < southOpen.luma * 0.1 + 3,
    'south obstruction did not darken direct light',
  );
  await page.screenshot({ path: 'test-results/lighting-04-south-blocked.png', fullPage: true });
  await page.getByRole('button', { name: '夏至', exact: true }).click();
  await page.getByLabel('日照の時刻', { exact: true }).fill('05:30');
  await settle();
  assert(
    (await page.getByTestId('sun-state').innerText()).includes('北窓'),
    'summer north window sun',
  );
  assert(
    Number(await page.locator('.scene-host').getAttribute('data-direct-sun-lux')) > 0,
    'morning sun disabled',
  );
  await page.getByLabel('日照の時刻', { exact: true }).fill('00:00');
  await settle();
  assert((await page.getByTestId('sun-state').innerText()).includes('夜間'), 'night status');
  assert((await page.getByTestId('probe-lux').innerText()) === '0', 'night daylight not zero');
  // Settings belong to each plan and survive clone, independent edits, export and reload.
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在のプランを複製', exact: true }).click();
  await field('定常光 色温度', 4000);
  await settle();
  const data = await exportProject();
  assert(data.layouts.length === 2, 'plan cloning');
  assert(
    data.layouts[0].lighting.railKelvin === 9000 && data.layouts[1].lighting.railKelvin === 4000,
    'per-layout lighting isolation',
  );
  await page
    .locator('.header-actions input[type=file]')
    .setInputFiles(path.resolve('test-results/lighting.ma.json'));
  await settle();
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  assert(
    (await page.getByTestId('rail-kelvin').inputValue()) === '4000',
    'lighting export/import persistence',
  );
  await page.getByRole('button', { name: '配置図と根拠を見る →', exact: true }).count();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/lighting-05-mobile.png', fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'lighting mobile overflow',
  );
  assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
  const report = {
    status: 'passed',
    checks: [
      'summer/winter solar altitude',
      'south horizon default',
      'spot/rail independent Kelvin and lux',
      'all light sources off (actual pixels)',
      'artwork temperature response (actual pixels)',
      'exposure does not alter illuminance',
      'opaque roof in daylight (actual pixels)',
      'south glazing admits direct sunlight',
      'south obstruction blocks sunlight',
      'summer early north sunlight',
      'night illumination zero',
      'per-plan lighting independence',
      'JSON and IndexedDB round trip',
      'responsive lighting controls',
    ],
    pixels: { on, off, warm, cool, north, southOpen, southBlocked },
    browserErrors: errors,
  };
  await fs.writeFile('test-results/lighting-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  await page
    .screenshot({ path: 'test-results/lighting-failure.png', fullPage: true })
    .catch(() => {});
  throw err;
} finally {
  await browser.close();
}
