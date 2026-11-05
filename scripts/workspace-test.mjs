import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { walls } from '../src/domain.js';
import { storedProject, waitProject } from './placement-test-helpers.mjs';

const root = path.resolve('tmp/workspace-test-build');
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', root], {
  env: { ...process.env, VITE_BASE_PATH: '/' },
  stdio: 'pipe',
});
const output = path.resolve('test-results/workspace');
await fs.mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
  };
  try {
    const body = await fs.readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const appURL = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const errors = [];
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
const page = await context.newPage();
const check = (name) => console.log(`PASS ${name}`);
const viewBox = (popup) => popup.locator('.plan-svg').getAttribute('viewBox');
async function openPlan() {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: '平面図を別ウィンドウで開く', exact: true }).click();
  const popup = await opened;
  await popup.locator('.plan-svg').waitFor();
  await popup.waitForFunction(
    () => getComputedStyle(document.querySelector('.plan-window')).display === 'flex',
  );
  return popup;
}
async function planPoint(popup, x, y) {
  return popup.locator('.plan-svg').evaluate(
    (svg, [x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
}

try {
  await page.goto(appURL, { waitUntil: 'networkidle' });
  await page.getByText('保存済み', { exact: false }).first().waitFor();
  assert.equal(await page.getByText('GALLERY / 01', { exact: true }).count(), 0);
  assert.equal(await page.locator('.workspace-title').count(), 0);
  const original = await page.locator('.viewport').boundingBox();
  assert(original.y < 180, 'title space is reclaimed for the viewport');
  await page.screenshot({ path: `${output}/workspace.png`, fullPage: true });
  await page.getByRole('textbox', { name: '作品を検索' }).fill('静か');
  await page.getByRole('button', { name: '左パネルを折り畳む', exact: true }).click();
  assert.equal(await page.locator('#library-panel').isVisible(), false);
  const leftCollapsed = await page.locator('.viewport').boundingBox();
  assert(leftCollapsed.width >= original.width + 230);
  await page.getByRole('button', { name: '右パネルを折り畳む', exact: true }).click();
  assert.equal(await page.locator('#inspector-panel').isVisible(), false);
  const bothCollapsed = await page.locator('.viewport').boundingBox();
  assert(bothCollapsed.width >= leftCollapsed.width + 260);
  await page.waitForFunction(() => {
    const host = document.querySelector('.scene-host');
    const canvas = host.querySelector('canvas');
    return Math.abs(host.clientWidth - canvas.clientWidth) < 2;
  });
  await page.screenshot({ path: `${output}/panels-collapsed.png`, fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#library-panel').isVisible(), false);
  assert.equal(await page.locator('#inspector-panel').isVisible(), false);
  await page.getByRole('button', { name: '左パネルを開く', exact: true }).click();
  await page.getByRole('button', { name: '右パネルを開く', exact: true }).click();
  await page.getByRole('textbox', { name: '作品を検索' }).fill('静か');
  await page.getByRole('button', { name: '左パネルを折り畳む', exact: true }).click();
  await page.getByRole('button', { name: '左パネルを開く', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '作品を検索' }).inputValue(), '静か');
  check(
    'panels collapse independently, enlarge and resize the viewport, retain inputs and persist after reload',
  );

  const popup = await openPlan();
  const initial = await viewBox(popup);
  assert.equal(await popup.title(), '平面図 | 間 MA');
  await page.getByRole('button', { name: '平面図ウィンドウを前面に表示' }).click();
  assert.equal(context.pages().length, 2, 'existing popup is reused');
  assert.equal(await page.locator('.view-modes button.active').innerText(), '並べる');
  await page.getByRole('textbox', { name: 'プロジェクト名' }).fill('別窓連動テスト');
  await popup.getByText('別窓連動テスト', { exact: false }).waitFor();
  const beforeNavigation = await waitProject(page, (p) => p.name === '別窓連動テスト');
  await popup.getByRole('button', { name: '平面図を拡大' }).click();
  assert.equal(await popup.getByLabel('平面図のズーム倍率').innerText(), '125%');
  assert.notEqual(await viewBox(popup), initial);
  await popup.getByRole('button', { name: '平面図を縮小' }).click();
  assert.equal(await popup.getByLabel('平面図のズーム倍率').innerText(), '100%');

  const anchor = await popup.locator('.plan-svg').evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const client = { x: rect.x + rect.width / 2 + 35, y: rect.y + rect.height / 2 + 30 };
    const world = new DOMPoint(client.x, client.y).matrixTransform(svg.getScreenCTM().inverse());
    return { client, world: { x: world.x, y: world.y } };
  });
  await popup.mouse.move(anchor.client.x, anchor.client.y);
  await popup.mouse.wheel(0, -220);
  await popup.waitForFunction(() => document.querySelector('output').textContent !== '100%');
  const anchored = await planPoint(popup, anchor.world.x, anchor.world.y);
  assert(
    Math.hypot(anchored.x - anchor.client.x, anchored.y - anchor.client.y) < 1,
    'wheel zoom preserves pointer anchor',
  );
  await popup.getByRole('button', { name: 'パン', exact: true }).click();
  const zoomed = await viewBox(popup);
  await popup.mouse.move(anchor.client.x, anchor.client.y);
  await popup.mouse.down();
  await popup.mouse.move(anchor.client.x + 80, anchor.client.y + 45, { steps: 5 });
  await popup.mouse.up();
  assert.notEqual(await viewBox(popup), zoomed);
  await popup.getByRole('button', { name: '全体を表示', exact: true }).click();
  assert.equal(await viewBox(popup), initial);
  assert.deepEqual(
    await storedProject(page),
    beforeNavigation,
    'navigation never changes project geometry or history',
  );
  await popup.getByRole('button', { name: 'パン', exact: true }).click();
  check(
    'independent styled window, reuse, live project title, button and cursor-anchored wheel zoom, pan and fit',
  );

  await popup
    .locator('.plan-art[data-placement-id="p-1"]')
    .locator('line')
    .last()
    .click({ force: true });
  const position = page.getByTestId('position-s');
  const oldPosition = Number(await position.inputValue());
  await position.fill(String(oldPosition + 200));
  await position.press('Tab');
  await popup.waitForFunction(
    (expected) =>
      document
        .querySelector('.plan-art[data-placement-id="p-1"] title')
        .textContent.includes(expected),
    (oldPosition + 200).toLocaleString('en-US'),
  );
  const project = await waitProject(
    page,
    (p) => p.layouts[0].placements[0].s === oldPosition + 200,
  );
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId);
  const placement = layout.placements.find((p) => p.id === 'p-1');
  const wall = walls(project.building, layout.partitions, project.rails).find(
    (w) => w.id === placement.wallId,
  );
  await popup.getByRole('button', { name: '平面図を拡大' }).click();
  const start = await planPoint(
    popup,
    wall.start.x + wall.tangent.x * placement.s,
    wall.start.z + wall.tangent.z * placement.s,
  );
  const end = await planPoint(
    popup,
    wall.start.x + wall.tangent.x * (placement.s + 400),
    wall.start.z + wall.tangent.z * (placement.s + 400),
  );
  await popup.mouse.move(start.x, start.y);
  await popup.mouse.down();
  await popup.mouse.move(end.x, end.y, { steps: 6 });
  await popup.mouse.up();
  await waitProject(page, (p) => p.layouts[0].placements[0].s === oldPosition + 600);
  assert.equal(Number(await position.inputValue()), oldPosition + 600);
  await popup.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitProject(page, (p) => p.layouts[0].placements[0].s === oldPosition + 200);
  await popup.locator('.plan-window-surface').focus();
  await popup.keyboard.press('Control+Shift+Z');
  await waitProject(page, (p) => p.layouts[0].placements[0].s === oldPosition + 600);
  await popup
    .locator('.plan-art[data-placement-id="p-1"]')
    .locator('line')
    .last()
    .click({ button: 'right', force: true });
  await popup.getByRole('menu', { name: '作品のメニュー' }).waitFor();
  assert.equal(await page.getByRole('menu').count(), 0);
  await popup.keyboard.press('Escape');
  assert.equal(await popup.getByRole('menu').count(), 0);
  await popup.screenshot({ path: `${output}/plan-window.png`, fullPage: true });
  check(
    'selection, numeric edits, dragging while zoomed, undo/redo shortcuts and context menus work across windows',
  );

  await popup.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '平面図を別ウィンドウで開く', exact: true }).waitFor();
  const reopened = await openPlan();
  await reopened.close();
  await page.getByRole('button', { name: '平面図を別ウィンドウで開く', exact: true }).waitFor();
  await page.evaluate(() => {
    window.originalOpen = window.open;
    window.open = () => null;
  });
  await page.getByRole('button', { name: '平面図を別ウィンドウで開く', exact: true }).click();
  await page.getByText('平面図を開くには、このサイトのポップアップを許可してください').waitFor();
  await page.evaluate(() => {
    window.open = window.originalOpen;
    delete window.originalOpen;
  });
  const closing = await openPlan();
  await page.reload({ waitUntil: 'networkidle' });
  assert(closing.isClosed(), 'parent reload closes its popup');
  check('toolbar/native close, reopening, popup-blocker guidance and parent cleanup');

  await page.getByRole('button', { name: '左パネルを折り畳む', exact: true }).click();
  await page.getByRole('button', { name: '右パネルを折り畳む', exact: true }).click();
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const rect = await page.locator('.main-workspace').boundingBox();
    assert.equal(Math.round(rect.width), width);
    assert(await page.getByRole('button', { name: '左パネルを開く', exact: true }).isVisible());
    assert(await page.getByRole('button', { name: '右パネルを開く', exact: true }).isVisible());
    assert(
      await page
        .getByRole('button', { name: '平面図を別ウィンドウで開く', exact: true })
        .isVisible(),
    );
    await page.screenshot({ path: `${output}/workspace-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '照明・日照', exact: false }).click();
  assert.equal(await page.locator('#inspector-panel').isVisible(), true);
  check('narrow-screen controls remain available; lighting action restores the hidden inspector');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(`Screenshots: ${output}`);
} catch (error) {
  for (const [index, openPage] of context.pages().entries()) {
    await openPage
      .screenshot({ path: `${output}/failure-${index}.png`, fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
