import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { lightingDefaults, solarPosition } from '../src/lighting.js';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const assert = (v, m) => {
  if (!v) throw new Error(m);
};
async function field(name, value) {
  const el = page.getByRole('spinbutton', { name, exact: true });
  await el.fill(String(value));
  await el.press('Tab');
  await settle();
}
async function settle() {
  await page.waitForTimeout(120);
  await page.locator('.save-status').filter({ hasText: '保存済み' }).waitFor();
  await page.waitForTimeout(200);
}
async function pixels(background = false) {
  return page.evaluate((bg) => {
    const source = document.querySelector('canvas'),
      c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const p = bg
      ? ctx.getImageData(5, 5, 10, 10).data
      : ctx.getImageData(c.width * 0.25, c.height * 0.06, c.width * 0.5, c.height * 0.3).data;
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
  }, background);
}
const time = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
await fs.mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  await page.getByRole('button', { name: '人工光のみ', exact: true }).click();
  await page.getByLabel('日照の時刻', { exact: true }).fill('00:00');
  await page.getByRole('button', { name: '北窓側から見る', exact: true }).click();
  await settle();
  await field('床・壁の反射光', 0);
  const uncorrected = await pixels();
  await page.screenshot({ path: 'test-results/reflection-0-night.png', fullPage: true });
  await field('床・壁の反射光', 100);
  const corrected = await pixels();
  assert(
    corrected.luma > uncorrected.luma + 15,
    `ceiling correction too small: ${JSON.stringify({ uncorrected, corrected })}`,
  );
  await page.screenshot({ path: 'test-results/reflection-100-night.png', fullPage: true });
  await field('床・壁の反射光', 200);
  const stronger = await pixels();
  assert(stronger.luma > corrected.luma + 5, 'reflection strength has no effect');
  await field('床・壁の反射光', 100);
  await page.getByLabel('日照の時刻', { exact: true }).fill('12:00');
  await settle();
  const midday = await pixels();
  assert(Math.abs(midday.luma - corrected.luma) < 2, 'artificial reflection changed with time');
  const l = lightingDefaults();
  let crossing = 0;
  for (let t = 900; t < 1260; t++)
    if (solarPosition(l.date, t, l.latitude, l.longitude).altitude <= 0) {
      crossing = t;
      break;
    }
  assert(crossing > 0, 'sunset not found');
  await page.getByRole('button', { name: '俯瞰', exact: true }).click();
  await page.getByRole('button', { name: '自然光のみ', exact: true }).click();
  const backgrounds = [];
  for (const t of [crossing - 1, crossing, crossing + 1]) {
    await page.getByLabel('日照の時刻', { exact: true }).fill(time(t));
    await settle();
    backgrounds.push(await pixels(true));
  }
  assert(
    Math.max(...backgrounds.map((p) => p.luma)) - Math.min(...backgrounds.map((p) => p.luma)) < 3,
    'background jumps at sunset',
  );
  assert(
    (await page.getByTestId('sun-state').innerText()).includes('薄明'),
    'twilight status missing',
  );
  await page.getByLabel('日照の時刻', { exact: true }).fill('00:00');
  await settle();
  const night = await pixels(true);
  assert(night.luma < backgrounds[1].luma - 30, 'background does not fade to night');
  await field('床・壁の反射光', 125);
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  assert(
    (await page.getByRole('spinbutton', { name: '床・壁の反射光', exact: true }).inputValue()) ===
      '125',
    'reflection setting did not persist',
  );
  assert(errors.length === 0, errors.join('; '));
  const result = {
    status: 'passed',
    checks: [
      'ceiling brightens with floor reflection',
      'adjustable reflection strength',
      'artificial reflection independent of hour',
      'continuous sunset background (actual pixels)',
      'gradual transition to night',
      'twilight status',
      'reflection persistence',
    ],
    uncorrected,
    corrected,
    stronger,
    midday,
    backgrounds,
    night,
    browserErrors: errors,
  };
  await fs.writeFile('test-results/reflection-report.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  await page
    .screenshot({ path: 'test-results/reflection-failure.png', fullPage: true })
    .catch(() => {});
  throw err;
} finally {
  await browser.close();
}
