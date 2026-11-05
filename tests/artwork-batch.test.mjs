import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, walls } from '../src/domain.js';
import {
  artworkBatchDimensions,
  previewArtworkAddition,
  newArtworkBatch,
  assertInventoryChange,
} from '../src/artworkPlacement.js';

const settings = { count: 6, columns: 3, gapX: 100, gapY: 200 };
const candidate = { wallId: 'west', s: 16000, bottom: 500 };
function fixture() {
  const project = createProject();
  project.layouts[0].placements = [];
  Object.assign(project.artworks[0], { quantity: 10, width: 900, height: 1100 });
  return project;
}
const preview = (p, point = candidate, options = settings) =>
  previewArtworkAddition(p, 'art-1', point, options);

test('行列全体をプレビューし、元データを変更せず、点数・間隔・左上からの順番を保つ', () => {
  const project = fixture(),
    before = structuredClone(project);
  const result = preview(project);
  assert.equal(result.valid, true);
  assert.equal(result.placements.length, 6);
  assert.deepEqual(artworkBatchDimensions(project.artworks[0], settings), {
    ...settings,
    rows: 2,
    width: 2900,
    height: 2400,
  });
  const [a, b, c, d] = result.placements;
  assert.equal(a.s - b.s, 1000, 'west wall front-facing order follows decreasing s');
  assert.equal(a.bottom - d.bottom, 1300);
  assert.equal(c.s, d.s - 2000);
  assert.deepEqual(project, before);
  const ids = result.placements.map((_, i) => `new-${i}`);
  const added = newArtworkBatch(project, 'art-1', result.anchor, settings, ids);
  assert.deepEqual(
    added.map((p) => ({ ...p, id: 'same' })),
    result.placements.map((p) => ({ ...p, id: 'same' })),
  );
  const next = structuredClone(project);
  next.layouts[0].placements.push(...added);
  assert.doesNotThrow(() => assertInventoryChange(project, next));
});

test('壁端・床・天井では行列全体を動かし、奇数寸法や間隔0でも再確定でずれない', () => {
  const project = fixture();
  Object.assign(project.artworks[0], { width: 901, height: 1101 });
  const options = { count: 5, columns: 3, gapX: 0, gapY: 0 };
  for (const s of [-99999, 99999]) {
    const result = preview(project, { ...candidate, s, bottom: 99999 }, options);
    assert.equal(result.valid, true);
    for (const p of result.placements) {
      assert.ok(p.s - 901 / 2 >= 0 && p.s + 901 / 2 <= 27035);
      assert.ok(p.bottom >= 0 && p.bottom + 1101 <= 5500);
    }
    const again = preview(project, result.anchor, options);
    assert.deepEqual(again.placements, result.placements);
  }
});

test('可動壁の表裏で正面から見た並びを合わせ、行列全体のサイズを判定する', () => {
  const project = fixture();
  project.layouts[0].partitions.push({
    id: 'part',
    name: '可動壁',
    railId: 'rail-cross-3',
    s: 4500,
    width: 3000,
    height: 5000,
    thickness: 200,
  });
  for (const face of ['front', 'back']) {
    const wallId = `partition:part:${face}`;
    const options = { count: 4, columns: 2, gapX: 100, gapY: 100 };
    const result = preview(project, { wallId, s: 1500, bottom: 500 }, options);
    assert.equal(result.valid, true);
    const wall = walls(project.building, project.layouts[0].partitions, project.rails).find(
      (w) => w.id === wallId,
    );
    const facing = Math.sign(wall.tangent.x * wall.normal.z - wall.tangent.z * wall.normal.x);
    assert.equal((result.placements[1].s - result.placements[0].s) * facing, 1000);
    assert.equal(preview(project, { wallId, s: 1500, bottom: 500 }, settings).valid, true);
    assert.equal(
      preview(project, { wallId, s: 1500, bottom: 500 }, { ...settings, columns: 6 }).valid,
      false,
    );
  }
});

test('グループ内の1点だけが他作品と重なっても全体を拒否し、数量・不正入力・短い壁を検証する', () => {
  const project = fixture();
  const result = preview(project);
  project.layouts[0].placements.push({ ...result.placements[4], id: 'existing' });
  const overlap = preview(project);
  assert.equal(overlap.valid, false);
  assert.match(overlap.message, /重なり/);
  assert.equal(overlap.placements.length, 6, 'all six previews stay available for red feedback');
  project.artworks[0].quantity = 6;
  assert.match(preview(project).message, /数量/);
  assert.throws(
    () =>
      newArtworkBatch(
        project,
        'art-1',
        candidate,
        settings,
        Array.from({ length: 6 }, (_, i) => `id-${i}`),
      ),
    /数量/,
  );
  project.layouts[0].placements = [];
  project.artworks[0].quantity = 10;
  for (const options of [
    { ...settings, count: 0 },
    { ...settings, count: 2.5 },
    { ...settings, columns: 7 },
    { ...settings, gapX: -1 },
  ])
    assert.equal(preview(project, candidate, options).valid, false);
  assert.match(preview(project, { ...candidate, wallId: 'north' }).message, /展示可能/);
  assert.match(preview(project, { ...candidate, s: NaN }).message, /不正/);
  assert.match(preview(project, { ...candidate, wallId: 'west-return' }).message, /収まりません/);
});
