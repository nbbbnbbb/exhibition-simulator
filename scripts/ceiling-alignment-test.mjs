import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
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
async function settle() {
  await page.waitForTimeout(150);
  await page.locator('.save-status').filter({ hasText: '保存済み' }).waitFor();
  await page.waitForTimeout(200);
}
async function field(name, value) {
  const el = page.getByRole('spinbutton', { name, exact: true });
  await el.fill(String(value));
  await el.press('Tab');
}
async function downloadModel(name) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: '現在の空間をGLB保存', exact: true }).click();
  const d = await promise;
  const dest = path.resolve('test-results/' + name + '.glb');
  await d.saveAs(dest);
  const bytes = await fs.readFile(dest),
    jsonLength = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  return { json, bytes, bin: 28 + jsonLength };
}
function vectors(model, index) {
  const a = model.json.accessors[index],
    v = model.json.bufferViews[a.bufferView],
    size = a.type === 'VEC4' ? 4 : 3,
    stride = v.byteStride || size * 4,
    start = model.bin + (v.byteOffset || 0) + (a.byteOffset || 0);
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: size }, (_, j) => model.bytes.readFloatLE(start + i * stride + j * 4)),
  );
}
function verifyModel(model, rails) {
  const nodes = model.json.nodes.filter((n) => n.extras?.architectureMembers),
    members = nodes.flatMap((n) => n.extras.architectureMembers),
    guides = nodes.find((n) => n.name === 'partition-track');
  assert(guides, 'movable track geometry missing');
  const positions = vectors(
      model,
      guides.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION,
    ),
    scales = vectors(model, guides.extensions.EXT_mesh_gpu_instancing.attributes.SCALE);
  assert(
    guides.extras.architectureMembers.length === rails.length,
    'ceiling track count differs from floor lines',
  );
  guides.extras.architectureMembers.forEach((m, i) => {
    const rail = rails.find((r) => r.id === m.railId);
    assert(rail, 'unknown rail');
    const x = (rail.x1 + rail.x2) / 2000,
      z = (rail.z1 + rail.z2) / 2000,
      length = Math.hypot(rail.x2 - rail.x1, rail.z2 - rail.z1) / 1000;
    assert(
      Math.abs(positions[i][0] - x) < 0.00001 && Math.abs(positions[i][2] - z) < 0.00001,
      'actual GLB ceiling/floor centre mismatch',
    );
    assert(Math.abs(scales[i][0] - length) < 0.00001, 'actual GLB track length mismatch');
  });
  assert(
    members.filter((m) => m.kind === 'carrier-concrete').length === rails.length,
    'carrier concrete missing',
  );
  assert(
    members.filter((m) => m.kind === 'concrete-only-cross').length > 0,
    'plain concrete cross beams removed',
  );
  assert(
    members.filter((m) => m.kind === 'concrete-only-spine').length === 3,
    'lighting-support concrete spines missing',
  );
  assert(
    model.json.nodes.filter((n) => n.extras?.spotTrack).length === 8,
    'physical spotlight rails missing',
  );
  return {
    carriers: rails.length,
    plainBeams: members.filter((m) => m.kind.startsWith('concrete-only')).length,
    physicalSpotTracks: 8,
  };
}
await fs.mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.carrierCount === '13',
  );
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  await settle();
  const first = await downloadModel('ceiling-aligned');
  const getProject = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('ma-exhibition-v1', 1);
          req.onsuccess = () => {
            const db = req.result,
              r = db.transaction('projects').objectStore('projects').get('current');
            r.onsuccess = () => {
              resolve(r.result);
              db.close();
            };
          };
          req.onerror = () => reject(req.error);
        }),
    );
  const initial = await getProject(),
    firstResult = verifyModel(first, initial.rails);
  await page.getByRole('button', { name: /^可動壁 \d/ }).click();
  await page.getByRole('button', { name: '配置ラインの座標を編集 →', exact: true }).click();
  await field('主室 横断 3 始点 Z', 14500);
  await field('主室 横断 3 終点 Z', 14500);
  const x = initial.rails.find((r) => r.id === 'rail-centre').x1 + 321;
  await field('主室 中央縦線 始点 X', x);
  await field('主室 中央縦線 終点 X', x);
  await page.getByRole('button', { name: '配置ラインを適用', exact: true }).click();
  await settle();
  await page.getByRole('button', { name: /^プラン \d/ }).click();
  const edited = await downloadModel('ceiling-edited');
  const project = await getProject();
  verifyModel(edited, project.rails);
  assert(
    project.rails.find((r) => r.id === 'rail-cross-3').z1 === 14500,
    'floor line edit missing',
  );
  await page
    .locator('.inspector-tabs')
    .getByRole('button', { name: '照明・日照', exact: true })
    .click();
  await page.getByRole('button', { name: '人工光のみ', exact: true }).click();
  await field('スポット 色温度', 5000);
  await field('定常光 色温度', 5000);
  await page.getByRole('button', { name: '北窓側から見る', exact: true }).click();
  await settle();
  const c = await page.locator('canvas').boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2 - 42, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/ceiling-walkthrough.png', fullPage: true });
  await page.getByRole('button', { name: '俯瞰', exact: true }).click();
  await page.getByRole('button', { name: '並べる', exact: true }).click();
  await settle();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas'),
      gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) return false;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = Infinity,
      max = -Infinity;
    for (let y = 0; y < canvas.height; y += 30)
      for (let x = 0; x < canvas.width; x += 30) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i + 3] !== 255) continue;
        const value = pixels[i] + pixels[i + 1] + pixels[i + 2];
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    return max - min > 40;
  });
  await page.screenshot({ path: 'test-results/ceiling-overview.png', fullPage: true });
  assert(errors.length === 0, 'WebGL errors: ' + errors.join('; '));
  const report = {
    status: 'passed',
    checks: [
      'one ceiling carrier per floor line',
      'actual GLB instance translations and lengths',
      'plain concrete cross beams retained',
      'concrete lighting-support spines retained',
      'physical spotlight rails retained',
      'horizontal/vertical line edits update ceiling geometry',
      'walkthrough and overview rendering',
    ],
    ...firstResult,
    browserErrors: errors,
  };
  await fs.writeFile('test-results/ceiling-alignment-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  await page
    .screenshot({ path: 'test-results/ceiling-alignment-failure.png', fullPage: true })
    .catch(() => {});
  throw err;
} finally {
  await browser.close();
}
