import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { frameGeometry } from '../src/steelFrames.js';
import { pointOnPlan, storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
// Native headless Chrome downloads are canceled in this environment, even for a minimal Blob.
// Capture the actual UI-generated export, then save and import those same bytes.
await page.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL),
    click = HTMLAnchorElement.prototype.click,
    blobs = new Map();
  window.__steelExports = [];
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && blobs.has(this.href)) {
      const item = { name: this.download, data: null };
      window.__steelExports.push(item);
      const reader = new FileReader();
      reader.onload = () => {
        item.data = reader.result;
      };
      reader.readAsDataURL(blobs.get(this.href));
      return;
    }
    return click.call(this);
  };
});
page.setDefaultTimeout(20000);
const root = path.resolve('dist'),
  output = 'test-results/steel-frames',
  errors = [],
  checks = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (err) => errors.push(err.message));
if (!process.env.MA_TEST_URL)
  await page.route('http://127.0.0.1:5173/**', async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname),
      file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
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
const layout = (p) => p.layouts.find((l) => l.id === p.activeLayoutId),
  frames = (p) => layout(p).steelFrames;
const field = async (name, value) => {
  const el = page.getByRole('spinbutton', { name, exact: true });
  await el.fill(String(value));
  await el.press('Enter');
};
const report = async (status, error) =>
  fs.writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        status,
        checks,
        errors,
        error,
        exportTransport:
          'Actual UI-generated Blobs captured; native headless Chrome downloads canceled by the environment',
      },
      null,
      2,
    ),
  );
try {
  await page.goto(process.env.MA_TEST_URL || 'http://127.0.0.1:5173/', {
    waitUntil: 'networkidle',
  });
  const original = await waitProject(page, (p) => !!p.frameShapes);
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.getByRole('button', { name: '＋ 鉄骨フレームを追加', exact: true }).click();
  let p = await waitProject(page, (p) => frames(p).length === 1),
    id = frames(p)[0].id;
  assert.deepEqual(layout(p).placements, layout(original).placements);
  await page.getByRole('checkbox', { name: '正面に膜を貼る', exact: true }).check();
  p = await waitProject(page, (p) => frames(p)[0].membrane.faces.length === 1);
  await field('フレーム幅', 3200);
  await field('膜の不透明度', 60);
  await field('フレーム回転角', 30);
  p = await waitProject(
    page,
    (p) =>
      frames(p)[0].width === 3200 &&
      frames(p)[0].rotation === 30 &&
      frames(p)[0].membrane.opacity === 0.6,
  );
  assert.equal(await page.locator('.scene-host').getAttribute('data-steel-membrane-count'), '1');
  checks.push('rectangle creation, section geometry, per-face membrane, dimensions and opacity');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const before = structuredClone(frames(p)[0]),
    { nodes } = frameGeometry(before, p);
  const start = [(nodes[0][0] + nodes[1][0]) / 2, (nodes[0][2] + nodes[1][2]) / 2];
  await pointOnPlan(page, ...start);
  await page.mouse.down();
  await pointOnPlan(page, start[0] + 700, start[1] + 900);
  await page.mouse.up();
  p = await waitProject(
    page,
    (p) =>
      frames(p)[0].x === Math.round((before.x + 700) / 10) * 10 &&
      frames(p)[0].z === Math.round((before.z + 900) / 10) * 10,
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await waitProject(page, (p) => frames(p)[0].x === before.x && frames(p)[0].z === before.z);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  p = await waitProject(page, (p) => frames(p)[0].x === Math.round((before.x + 700) / 10) * 10);
  const moved = structuredClone(frames(p)[0]),
    pts = frameGeometry(moved, p).nodes;
  const grab = [(pts[0][0] + pts[1][0]) / 2, (pts[0][2] + pts[1][2]) / 2];
  await pointOnPlan(page, ...grab);
  await page.mouse.down();
  await pointOnPlan(page, grab[0] + 500, grab[1] + 500);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.deepEqual(frames(await storedProject(page))[0], moved);
  checks.push('free plan drag, one-step undo/redo, Escape cancellation');
  await page.locator('.steel-frame-card').first().click();
  await field('フレーム中心 X', 0);
  await page.waitForTimeout(500);
  assert.equal(frames(await storedProject(page))[0].x, moved.x);
  await field('フレーム回転角', 0);
  await waitProject(page, (p) => frames(p)[0].rotation === 0);
  await page.getByRole('button', { name: 'フレームを正面から確認', exact: true }).click();
  await page.waitForTimeout(800);
  p = await storedProject(page);
  const f = frames(p)[0],
    distance = (Math.max(f.width, f.height, f.depth) / 1000) * 1.7;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
  camera.position.set(
    f.x / 1000,
    (f.y + f.height / 2) / 1000 + distance * 0.25,
    f.z / 1000 + distance,
  );
  camera.lookAt(f.x / 1000, (f.y + f.height / 2) / 1000, f.z / 1000);
  camera.updateMatrixWorld();
  const projectPoint = async (node) => {
    const rect = await page.locator('canvas').boundingBox();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    const v = new THREE.Vector3(...node.map((v) => v / 1000)).project(camera);
    return { x: rect.x + ((v.x + 1) * rect.width) / 2, y: rect.y + ((1 - v.y) * rect.height) / 2 };
  };
  const verts = frameGeometry(f, p).nodes,
    a = await projectPoint(verts[2].map((v, i) => (v + verts[3][i]) / 2));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 45, a.y + 12, { steps: 8 });
  await page.mouse.up();
  p = await waitProject(page, (p) => frames(p)[0].x !== f.x || frames(p)[0].z !== f.z);
  checks.push('out-of-bounds edits rejected and actual 3D frame drag committed');
  await page.screenshot({ path: `${output}/rectangle-3d.png`, fullPage: true });
  await page.getByRole('button', { name: '＋ 鉄骨フレームを追加', exact: true }).click();
  await waitProject(page, (p) => frames(p).length === 2);
  await page.getByRole('combobox', { name: 'フレームの組立形状', exact: true }).selectOption('box');
  await page.getByRole('button', { name: '全ての面に貼る', exact: true }).click();
  p = await waitProject(
    page,
    (p) => frames(p)[1].shapeId === 'box' && frames(p)[1].membrane.faces.length === 6,
  );
  await page.getByRole('checkbox', { name: '下面に膜を貼る', exact: true }).uncheck();
  await page.getByRole('combobox', { name: '鉄骨の部材断面', exact: true }).selectOption('tube25');
  p = await waitProject(
    page,
    (p) => frames(p)[1].sectionId === 'tube25' && frames(p)[1].membrane.faces.length === 5,
  );
  await page.getByRole('button', { name: 'フレームを正面から確認', exact: true }).click();
  await page.screenshot({ path: `${output}/box-membrane.png`, fullPage: true });
  checks.push('box conversion, six face membranes, individual removal, hollow steel section');
  await page.getByRole('button', { name: '独自の組立形状を登録', exact: true }).click();
  await page.getByRole('textbox', { name: '登録する形状名', exact: true }).fill('台形テスト');
  await page
    .getByRole('textbox', { name: '形状の頂点座標', exact: true })
    .fill('0,0,0\n3000,0,0\n2400,2000,0\n600,2000,0');
  await page.getByRole('button', { name: '組立形状を登録', exact: true }).click();
  p = await waitProject(page, (p) => p.frameShapes.length === 1);
  const shapeId = p.frameShapes[0].id;
  await page
    .getByRole('combobox', { name: '追加するフレーム形状', exact: true })
    .selectOption(shapeId);
  await page.getByRole('button', { name: '＋ 鉄骨フレームを追加', exact: true }).click();
  await waitProject(page, (p) => frames(p).length === 3);
  await page.getByRole('checkbox', { name: '面1に膜を貼る', exact: true }).check();
  await page.getByRole('button', { name: '独自の部材断面を登録', exact: true }).click();
  await page.getByRole('textbox', { name: '登録する断面名', exact: true }).fill('独自Lテスト');
  await page.getByRole('button', { name: '部材断面を登録', exact: true }).click();
  p = await waitProject(
    page,
    (p) => p.steelSections.length === 1 && frames(p)[2].sectionId === p.steelSections[0].id,
  );
  await page.getByRole('button', { name: 'フレームを正面から確認', exact: true }).click();
  await page.screenshot({ path: `${output}/custom-frame.png`, fullPage: true });
  checks.push('custom trapezoid shape and custom section registration, selection and membrane');
  await page.getByRole('button', { name: 'フレームを複製', exact: true }).click();
  p = await waitProject(page, (p) => frames(p).length === 4);
  await page.getByRole('button', { name: 'フレームを削除', exact: true }).click();
  await waitProject(page, (p) => frames(p).length === 3);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  p = await waitProject(page, (p) => frames(p).length === 4);
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在のプランを複製', exact: true }).click();
  p = await waitProject(page, (p) => p.layouts.length === 2);
  const sourceId = p.layouts[0].id;
  await page.getByRole('button', { name: /^鉄骨 \d/ }).click();
  await page.locator('.steel-frame-card').first().click();
  await field('膜の不透明度', 25);
  p = await waitProject(page, (p) => frames(p)[0].membrane.opacity === 0.25);
  assert.equal(p.layouts.find((l) => l.id === sourceId).steelFrames[0].membrane.opacity, 0.6);
  checks.push('duplicate/delete/undo and independent frame/membrane data per plan');
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  await page.waitForFunction(() =>
    window.__steelExports.some((e) => e.name.endsWith('.ma.json') && e.data),
  );
  const jsonData = await page.evaluate(
    () => window.__steelExports.find((e) => e.name.endsWith('.ma.json')).data,
  );
  const jsonPath = path.resolve(output, 'roundtrip.ma.json');
  await fs.writeFile(jsonPath, Buffer.from(jsonData.split(',')[1], 'base64'));
  const saved = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.deepEqual(saved, p);
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (q) => q.frameShapes.length === 1 && frames(q).length === 4);
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await page.locator('input[type=file][accept=".json"]').setInputFiles(jsonPath);
  await waitProject(page, (q) => q.name === saved.name && q.layouts.length === 2);
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  await page.waitForFunction(() =>
    window.__steelExports.some((e) => e.name.endsWith('.glb') && e.data),
  );
  const glbData = await page.evaluate(
    () => window.__steelExports.find((e) => e.name.endsWith('.glb')).data,
  );
  const glbPath = path.resolve(output, 'frames.glb');
  await fs.writeFile(glbPath, Buffer.from(glbData.split(',')[1], 'base64'));
  const bytes = await fs.readFile(glbPath);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  const chunkLength = bytes.readUInt32LE(12),
    gltf = JSON.parse(bytes.toString('utf8', 20, 20 + chunkLength));
  assert.ok(gltf.nodes.some((n) => n.name?.includes('ビニール膜')));
  assert.ok(gltf.materials.some((m) => m.alphaMode === 'BLEND' && m.doubleSided));
  assert.ok(!gltf.nodes.some((n) => n.extras?.uiOnly), 'GLB excludes editor picking aids');
  checks.push('JSON export/import, IndexedDB reload, GLB membrane alpha and metres');
  assert.deepEqual(errors, []);
  await report('passed');
  console.log(JSON.stringify({ status: 'passed', checks, errors }, null, 2));
} catch (err) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await report('failed', err.stack);
  await fs
    .writeFile(`${output}/failure-project.json`, JSON.stringify(await storedProject(page), null, 2))
    .catch(() => {});
  throw err;
} finally {
  await browser.close();
}
