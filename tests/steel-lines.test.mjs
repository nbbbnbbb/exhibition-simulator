import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createProject, validateProject } from '../src/domain.js';
import { frameGeometry, newSteelFrame, validateFrame } from '../src/steelFrames.js';
import { makeSteelFrame } from '../src/SteelFrames3D.js';
import {
  newSteelLine,
  pointOnSteelPlane,
  previewSteelLine,
  steelLineEndpoints,
  steelLineLength,
  withSteelLineEndpoints,
} from '../src/steelLinePlacement.js';

test('水平・垂直・斜めのラインはクリックした端点を保って実寸の部材になる', () => {
  const p = createProject(),
    start = [3000, 500, 14000];
  for (const end of [
    [5500, 500, 14000],
    [3000, 3000, 14000],
    [5000, 2800, 16000],
    [3000, 500, 12000],
  ]) {
    const f = newSteelLine(p, start, end, 'tube25');
    assert.deepEqual(steelLineEndpoints(f), [start, end]);
    assert.equal(steelLineLength(f), Math.hypot(...end.map((v, i) => v - start[i])));
    assert.deepEqual(frameGeometry(f, p).nodes, [start, end]);
    const group = makeSteelFrame(f, p);
    group.updateMatrixWorld(true);
    const mesh = group.children.find((m) => m.userData.steelMember);
    const actual = new Vector3(0, 0, steelLineLength(f) / 1000).applyMatrix4(mesh.matrixWorld);
    end.forEach((v, i) => assert.ok(Math.abs(actual.getComponent(i) - v / 1000) < 1e-6));
    assert.equal(group.children.filter((m) => m.userData.steelMember).length, 1);
  }
});
test('水平・垂直の作業面と1mm/10mmスナップ、平行・背面の光線を検証する', () => {
  assert.deepEqual(
    pointOnSteelPlane([1001, 3000, 14003], [0.2, -1, 0.1], { plane: 'xz', offset: 1500 }),
    [1300, 1500, 14150],
  );
  assert.deepEqual(
    pointOnSteelPlane([1001, 3000, 14003], [0.2, -1, 0.1], { plane: 'xz', offset: 1500 }, 1),
    [1301, 1500, 14153],
  );
  assert.deepEqual(
    pointOnSteelPlane([2000, 4000, 20000], [0, -0.5, -1], { plane: 'xy', offset: 15000 }),
    [2000, 1500, 15000],
  );
  assert.deepEqual(
    pointOnSteelPlane([2000, 1500, 12000], [1, 0.5, 1], { plane: 'yz', offset: 4000 }),
    [4000, 2500, 14000],
  );
  assert.equal(pointOnSteelPlane([0, 0, 0], [1, 0, 0], { plane: 'xz', offset: 1500 }), null);
  assert.equal(pointOnSteelPlane([0, 0, 0], [0, -1, 0], { plane: 'xz', offset: 1500 }), null);
});
test('プレビュー中はプロジェクトを変えず、部材の範囲・長さ・床天井を検証する', () => {
  const p = createProject(),
    before = structuredClone(p),
    tool = { plane: 'xz', offset: 1500, sectionId: 'c65', start: [3000, 1500, 14000] };
  assert.equal(previewSteelLine(p, tool, [5500, 1500, 14000]).valid, true);
  for (const point of [
    [3000, 1500, 14000],
    [3010, 1500, 14000],
    [0, 1500, 14000],
    [4000, 0, 14000],
    [4000, 5500, 14000],
  ])
    assert.equal(previewSteelLine(p, tool, point).valid, false);
  assert.equal(
    previewSteelLine(p, { ...tool, start: null }, [3000, 1500, 14000], true).snapped,
    true,
  );
  assert.equal(previewSteelLine(p, tool, null).point, null);
  const missingSection = previewSteelLine(
    p,
    { ...tool, sectionId: 'missing' },
    [5500, 1500, 14000],
  );
  assert.equal(missingSection.valid, false);
  assert.equal(missingSection.frame, undefined);
  assert.deepEqual(p, before);
});
test('L字の入り隅をまたぐラインを拒否し、西室内のラインを許可する', () => {
  const p = createProject();
  assert.throws(() => newSteelLine(p, [-2000, 1500, 32000], [3000, 1500, 28000], 'c65'), /範囲外/);
  assert.doesNotThrow(() => newSteelLine(p, [-5000, 1500, 34000], [-2000, 1500, 40000], 'c65'));
});
test('端点編集・全体移動・JSON保存・プラン複製でラインの座標を保持する', () => {
  const p = createProject(),
    f = newSteelLine(p, [2000, 1500, 14000], [5000, 3000, 16000], 'c65');
  const edited = withSteelLineEndpoints(f, [2500, 1000, 14000], [6000, 2500, 17000]);
  validateFrame(edited, p);
  const moved = { ...edited, x: edited.x + 500, z: edited.z + 1000 };
  validateFrame(moved, p);
  assert.deepEqual(moved.lineEnd, edited.lineEnd);
  p.layouts[0].steelFrames.push(moved, newSteelFrame(p, 'rectangle'));
  const copy = structuredClone(p.layouts[0]);
  copy.id = 'copy';
  copy.steelFrames[0].lineEnd[1] += 300;
  p.layouts.push(copy);
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored, p);
  assert.equal(p.layouts[0].steelFrames[0].lineEnd[1], 1500);
});
test('壊れたライン・断面・単独ラインへの膜の追加を拒否する', () => {
  const p = createProject(),
    f = newSteelLine(p, [3000, 1000, 14000], [5000, 1000, 14000], 'c65');
  for (const change of [
    { lineEnd: [1, 2] },
    { lineEnd: [Infinity, 0, 0] },
    { lineEnd: [1.5, 0, 0] },
    { lineEnd: [0, 0, 0] },
    { lineEnd: [30001, 0, 0] },
    { sectionId: 'missing' },
    { rotation: 90 },
    { membrane: { ...f.membrane, faces: [0] } },
  ])
    assert.throws(() => validateFrame({ ...f, ...change }, p));
  assert.throws(() => validateFrame({ ...newSteelFrame(p, 'rectangle'), kind: 'unknown' }, p));
});
