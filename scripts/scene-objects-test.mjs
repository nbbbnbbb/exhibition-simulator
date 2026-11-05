import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { storedProject, waitProject } from './placement-test-helpers.mjs';

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
page.setDefaultTimeout(20000);
const root = path.resolve('dist'),
  output = 'test-results/scene-objects',
  errors = [];
await fs.mkdir(output, { recursive: true });
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL),
    blobs = new Map();
  window.__objectExports = [];
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    blobs.set(url, blob);
    return url;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && blobs.has(this.href)) {
      const item = { name: this.download, data: null };
      window.__objectExports.push(item);
      const reader = new FileReader();
      reader.onload = () => {
        item.data = reader.result;
      };
      reader.readAsDataURL(blobs.get(this.href));
    } else return click.call(this);
  };
});
await page.route('http://127.0.0.1:5173/**', async (route) => {
  const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: '' });
  try {
    await route.fulfill({
      body: await fs.readFile(file),
      contentType:
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
        }[path.extname(file)] || 'application/octet-stream',
    });
  } catch {
    await route.fulfill({ status: 404, body: '' });
  }
});
const objects = (p) => p.layouts.find((l) => l.id === p.activeLayoutId).sceneObjects;
const library = () => page.locator('.scene-object-library');
const inspector = () => page.locator('.scene-object-inspector');
async function field(scope, name, value) {
  const input = scope.getByRole('spinbutton', { name, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
}
async function planPoint(x, z) {
  return page.locator('.plan-panel svg').evaluate(
    (svg, [x, z]) => {
      const p = new DOMPoint(x, z).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, z],
  );
}
async function focusPoint(object, normalizedX, normalizedY) {
  const box = await page.locator('canvas').boundingBox();
  const angle = (object.rotation * Math.PI) / 180,
    distance = Math.max(2, (Math.max(object.width, object.height, object.depth) / 1000) * 1.8);
  const target = new THREE.Vector3(
    object.x / 1000,
    (object.y + object.height / 2) / 1000,
    object.z / 1000,
  );
  const camera = new THREE.PerspectiveCamera(50, box.width / box.height, 0.03, 250);
  camera.position
    .copy(target)
    .add(new THREE.Vector3(Math.sin(angle) * distance, distance * 0.2, Math.cos(angle) * distance));
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(
    object.x / 1000 + normalizedX,
    (object.y + normalizedY * object.height) / 1000,
    object.z / 1000,
  ).project(camera);
  return { x: box.x + ((p.x + 1) * box.width) / 2, y: box.y + ((1 - p.y) * box.height) / 2 };
}

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await waitProject(page, (p) => p.layouts[0].sceneObjects.length === 0);
  await page.getByRole('button', { name: /^形状・人/ }).click();
  let count = 0;
  for (const kind of ['box', 'plane', 'table', 'cylinder', 'sphere', 'polygon']) {
    await library().getByRole('combobox', { name: '追加する形状' }).selectOption(kind);
    await field(library(), '幅', 1800);
    await field(library(), '高さ', 900);
    if (kind !== 'plane') await field(library(), '奥行', 700);
    if (kind === 'polygon') {
      await library().getByRole('button', { name: '描き直す', exact: true }).click();
      await library().getByRole('button', { name: '＋ 形状を追加', exact: true }).click();
      await library().getByRole('alert').waitFor();
      const outline = library().getByRole('img', { name: '多角形の輪郭を描く' });
      for (const point of [
        [0, 0],
        [1, 0],
        [1, 0.5],
        [0.5, 0.5],
        [0.5, 1],
        [0, 1],
      ]) {
        const client = await outline.evaluate((svg, [x, y]) => {
          const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
          return { x: p.x, y: p.y };
        }, point);
        await page.mouse.click(client.x, client.y);
      }
    }
    await library().getByRole('button', { name: '＋ 形状を追加', exact: true }).click();
    count++;
    let p = await waitProject(page, (p) => objects(p).length === count);
    const object = objects(p).at(-1);
    assert.equal(object.kind, kind);
    assert.equal(object.width, 1800);
    assert.equal(object.height, 900);
    await field(inspector(), '位置 X', 2500 + (count % 2) * 3000);
    await field(inspector(), '位置 Z', 7000 + count * 2200);
    if (kind === 'plane') {
      await inspector().getByRole('combobox', { name: '平面の向き' }).selectOption('horizontal');
      await field(inspector(), '床からの高さ', 750);
      await waitProject(
        page,
        (p) => objects(p).find((o) => o.id === object.id).orientation === 'horizontal',
      );
    }
  }
  console.log('PASS: six dimensioned shapes, concave outline, horizontal plane and base height');
  await library().getByRole('button', { name: '人物シルエット', exact: true }).click();
  assert.equal(await library().locator('.silhouette-choices button').count(), 11);
  await library().getByRole('button', { name: '人物 11', exact: true }).click();
  await field(library(), '身長', 1800);
  await library().getByRole('slider', { name: '透明度' }).fill('65');
  await library().getByRole('button', { name: '＋ 人物を追加', exact: true }).click();
  count++;
  let p = await waitProject(page, (p) => objects(p).length === count),
    person = objects(p).at(-1);
  assert.equal(person.silhouetteId, 'person-11');
  assert.equal(person.opacity, 0.35);
  assert.equal(person.y, 0);
  await field(inspector(), '位置 X', 4000);
  await field(inspector(), '位置 Z', 24000);
  await field(inspector(), '身長', 1900);
  p = await waitProject(page, (p) => objects(p).at(-1).height === 1900);
  person = objects(p).at(-1);
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const start = await planPoint(person.x, person.z),
    end = await planPoint(person.x + 1000, person.z + 800);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  p = await waitProject(page, (p) => objects(p).at(-1).x === 5000 && objects(p).at(-1).z === 24800);
  assert.equal(objects(p).at(-1).y, 0);
  console.log('PASS: 11 choices, height/opacity editing and plan drag with feet fixed to floor');
  await inspector().getByRole('button', { name: '複製', exact: true }).click();
  count++;
  await waitProject(page, (p) => objects(p).length === count);
  await inspector().getByRole('button', { name: '配置を削除', exact: true }).click();
  count--;
  await waitProject(page, (p) => objects(p).length === count);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  count++;
  await waitProject(page, (p) => objects(p).length === count);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  count--;
  await waitProject(page, (p) => objects(p).length === count);
  await page.locator('.scene-object-list button').last().click();
  await inspector().getByRole('button', { name: '3Dでこの配置を見る', exact: true }).click();
  await page.waitForFunction(() => {
    const host = document.querySelector('.scene-host');
    const canvas = host.querySelector('canvas');
    return (
      document.querySelector('.view-modes button.active')?.textContent.trim() === '3D' &&
      Math.abs(parseFloat(canvas.style.width) - host.clientWidth) < 1
    );
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  p = await storedProject(page);
  person = objects(p).at(-1);
  const s = (await import('../src/sceneObjects.js')).silhouettes.find(
    (s) => s.id === person.silhouetteId,
  );
  const { makeSceneObject } = await import('../src/SceneObjects3D.js');
  const mesh = makeSceneObject({ ...person, x: 0, z: 0 });
  mesh.updateMatrixWorld(true);
  // Pick an interior torso point on the actual outline rather than its empty bounding box.
  const torsoHits = [];
  for (
    let x = (-s.aspect * person.height) / 2000;
    x < (s.aspect * person.height) / 2000;
    x += 0.01
  ) {
    if (
      new THREE.Raycaster(
        new THREE.Vector3(x, (person.height / 1000) * 0.6, 1),
        new THREE.Vector3(0, 0, -1),
      ).intersectObject(mesh, true).length
    ) {
      torsoHits.push(x);
    }
  }
  assert.ok(torsoHits.length > 0);
  const torso = torsoHits[Math.floor(torsoHits.length / 2)];
  const pt = await focusPoint(person, torso, 0.6);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.getByRole('menu', { name: '形状・人物のメニュー' }).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${output}/silhouette.png`, fullPage: true });
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 45, pt.y + 10, { steps: 8 });
  await page.mouse.up();
  p = await waitProject(page, (p) => objects(p).at(-1).x !== person.x);
  assert.equal(objects(p).at(-1).y, 0);
  console.log('PASS: copy/delete/undo/redo, 3D selection/context menu and drag');
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在のプランを複製', exact: true }).click();
  p = await waitProject(page, (p) => p.layouts.length === 2);
  assert.deepEqual(p.layouts[0].sceneObjects, p.layouts[1].sceneObjects);
  await page.getByRole('button', { name: /^形状・人/ }).click();
  await page.locator('.scene-object-list button').last().click();
  await inspector().getByRole('slider', { name: '透明度' }).fill('20');
  p = await waitProject(page, (p) => objects(p).at(-1).opacity === 0.8);
  assert.equal(p.layouts[0].sceneObjects.at(-1).opacity, 0.35);
  await page.getByRole('button', { name: '書き出す', exact: true }).click();
  await page.waitForFunction(() =>
    window.__objectExports.some((e) => e.name.endsWith('.ma.json') && e.data),
  );
  const exported = await page.evaluate(
    () => window.__objectExports.find((e) => e.name.endsWith('.ma.json')).data,
  );
  const buffer = Buffer.from(exported.split(',')[1], 'base64');
  assert.deepEqual(JSON.parse(buffer), p);
  await page.reload({ waitUntil: 'networkidle' });
  await waitProject(page, (q) => q.layouts.length === 2 && objects(q).length === count);
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await page
    .locator('input[type=file][accept=".json"]')
    .setInputFiles({ name: 'objects.ma.json', mimeType: 'application/json', buffer });
  await waitProject(page, (q) => objects(q).at(-1).opacity === 0.8);
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  await page.waitForFunction(() =>
    window.__objectExports.some((e) => e.name.endsWith('.glb') && e.data),
  );
  const glb = Buffer.from(
    (
      await page.evaluate(() => window.__objectExports.find((e) => e.name.endsWith('.glb')).data)
    ).split(',')[1],
    'base64',
  );
  assert.equal(glb.subarray(0, 4).toString(), 'glTF');
  const jsonLength = glb.readUInt32LE(12),
    gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  assert.equal(gltf.nodes.filter((n) => n.extras?.sceneObjectId && n.name).length, count);
  await fs.writeFile(`${output}/objects.glb`, glb);
  await page.getByRole('button', { name: /^形状・人/ }).click();
  await page.getByRole('button', { name: '並べる', exact: true }).click();
  await page.screenshot({ path: `${output}/workspace.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: independent plan copies, save/reload, JSON round trip, GLB with all objects; no browser errors',
  );
} catch (err) {
  console.error('Browser errors:', errors);
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw err;
} finally {
  await browser.close();
}
