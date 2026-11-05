import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createProject, validateProject } from '../src/domain.js';
import { frameGeometry, newSteelFrame, validateFrame } from '../src/steelFrames.js';
import { makeSteelFrame } from '../src/SteelFrames3D.js';
import {
  steelSnapGeometry,
  snapSteelPoint,
  steelOrthogonalConstraint,
  constrainSteelPoint,
} from '../src/steelSnapping.js';
import {
  newSteelLine,
  pointOnSteelPlane,
  previewSteelLine,
  steelLineEndpoints,
  steelLineLength,
  withSteelLineEndpoints,
  steelPlaneCenter,
  moveSteelPlane,
  DEFAULT_STEEL_LINE_SETTINGS,
} from '../src/steelLinePlacement.js';

const xyProject = (p) => ({ x: p[0] / 10, y: p[1] / 10, depth: 0, w: 1 });

test('スナップ候補はアクティブプランの鉄骨と建物の角・辺を実寸で取得する', () => {
  const p = createProject();
  const line = newSteelLine(p, [-2000, -500, 14000], [3000, 2500, 15000], 'c65');
  const rectangle = { ...newSteelFrame(p, 'rectangle'), rotation: 37 };
  p.layouts[0].steelFrames.push(line, rectangle);
  const other = structuredClone(p.layouts[0]);
  other.id = 'inactive';
  other.steelFrames[0].x = 50000;
  p.layouts.push(other);
  const before = structuredClone(p),
    targets = steelSnapGeometry(p);
  assert.equal(targets.steel.points.length, 6);
  assert.equal(targets.steel.edges.length, 5);
  assert.deepEqual(targets.steel.points[0].point, [-2000, -500, 14000]);
  assert.deepEqual(targets.steel.points[2].point, frameGeometry(rectangle, p).nodes[0]);
  assert.ok(!targets.steel.points.some((t) => t.point[0] >= 50000));
  assert.ok(
    targets.all.points.some((t) => t.label === '天井の角' && t.point[1] === p.building.height),
  );
  assert.ok(
    targets.all.edges.some(
      (t) =>
        t.label === '建物の壁の辺' &&
        t.a[0] === 0 &&
        t.b[0] === 0 &&
        t.a[1] === 0 &&
        t.b[1] === p.building.height,
    ),
  );
  assert.ok(targets.all.points.some((t) => t.label === '梁の角'));
  assert.deepEqual(p, before);
});

test('端点を優先して吸着し、範囲外・OFF・背面の候補を吸着しない', () => {
  const targets = {
    points: [{ point: [2000, 1000, 0], label: '端点' }],
    edges: [{ a: [0, 1000, 0], b: [4000, 1000, 0], label: '辺' }],
  };
  assert.deepEqual(snapSteelPoint([1990, 1010, 0], targets, xyProject), {
    point: [2000, 1000, 0],
    label: '端点',
  });
  assert.equal(snapSteelPoint([2000, 1000, 0], targets, xyProject, { enabled: false }), null);
  assert.equal(snapSteelPoint([2000, 1300, 0], targets, xyProject), null);
  assert.equal(
    snapSteelPoint([2000, 1000, 0], targets, (p) => ({ ...xyProject(p), depth: 2 })),
    null,
  );
  assert.deepEqual(snapSteelPoint([1000, 1040, 0], targets, xyProject), {
    point: [1000, 1000, 0],
    label: '辺',
  });
});

test('遠近の異なる部材の途中にもスクリーン座標から正しく吸着する', () => {
  const targets = {
    points: [],
    edges: [{ a: [0, 0, 1000], b: [1000, 0, 2000], label: '鉄骨の部材' }],
  };
  const project = (p) => ({ x: (p[0] / p[2]) * 100, y: (p[1] / p[2]) * 100, w: p[2], depth: 0 });
  const result = snapSteelPoint([0, 0, 1000], targets, project, { cursor: { x: 25, y: 2 } });
  assert.deepEqual(result.point, [333, 0, 1333]);
  assert.equal(result.label, '鉄骨の部材');
});

test('直交モードは各作業平面の軸を守り、OFFや始点指定前は拘束しない', () => {
  const start = [1000, 1500, 14000];
  for (const [plane, point, axis] of [
    ['xz', [4000, 1500, 14500], 0],
    ['xz', [1200, 1500, 17000], 2],
    ['xy', [1300, 4500, 14000], 1],
    ['yz', [1000, 4500, 14500], 1],
    ['yz', [1000, 1700, 18000], 2],
  ]) {
    const tool = { plane, start, orthogonal: true };
    const constraint = steelOrthogonalConstraint(tool, point);
    assert.deepEqual(constraint.axes, [axis]);
    const end = constrainSteelPoint(point, constraint);
    assert.equal(end[axis], point[axis]);
    end.forEach((v, i) => {
      if (i !== axis) assert.equal(v, start[i]);
    });
    assert.equal(steelOrthogonalConstraint({ ...tool, orthogonal: false }, point), null);
    assert.equal(steelOrthogonalConstraint({ ...tool, start: null }, point), null);
  }
});

test('直交とスナップを併用すると、軸外の端点を避けて辺との交点に吸着する', () => {
  const constraint = { origin: [1000, 1500, 0], axes: [0] };
  const targets = {
    points: [{ point: [5000, 1600, 0], label: '軸外端点' }],
    edges: [{ a: [5000, 0, 0], b: [5000, 5500, 0], label: '建物の壁の辺' }],
  };
  assert.deepEqual(snapSteelPoint([5010, 1550, 0], targets, xyProject, { constraint }), {
    point: [5000, 1500, 0],
    label: '建物の壁の辺',
  });
  targets.edges = [{ a: [2000, 0, 0], b: [6000, 4000, 0], label: '斜めの鉄骨' }];
  assert.deepEqual(snapSteelPoint([3510, 1510, 0], targets, xyProject, { constraint }), {
    point: [3500, 1500, 0],
    label: '斜めの鉄骨',
  });
  targets.edges[0].b[2] = 500;
  assert.equal(snapSteelPoint([3510, 1510, 0], targets, xyProject, { constraint }), null);
});

test('作業平面の中心は鉄骨へ吸着し、XYZハンドルの移動軸も保持する', () => {
  const targets = { points: [{ point: [5000, 1500, 14000], label: '鉄骨の端点' }], edges: [] };
  assert.deepEqual(
    snapSteelPoint([4980, 1530, 14000], targets, xyProject).point,
    [5000, 1500, 14000],
  );
  assert.equal(
    snapSteelPoint([4980, 1530, 14000], targets, xyProject, {
      constraint: { origin: [4000, 1530, 14000], axes: [0] },
    }),
    null,
  );
  assert.deepEqual(
    snapSteelPoint([4980, 1500, 14000], targets, xyProject, {
      constraint: { origin: [4000, 1500, 14000], axes: [0] },
    }).point,
    [5000, 1500, 14000],
  );
});

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
test('プレビューは長さ・数値を検証し、建物外・床下・天井の外も許可する', () => {
  const p = createProject(),
    before = structuredClone(p),
    tool = { plane: 'xz', offset: 1500, sectionId: 'c65', start: [3000, 1500, 14000] };
  assert.equal(previewSteelLine(p, tool, [5500, 1500, 14000]).valid, true);
  for (const point of [
    [3000, 1500, 14000],
    [3010, 1500, 14000],
  ])
    assert.equal(previewSteelLine(p, tool, point).valid, false);
  for (const point of [
    [-2000, 1500, 14000],
    [4000, -1000, 14000],
    [4000, 10000, 14000],
    [4000, 1500, -5000],
  ])
    assert.equal(previewSteelLine(p, tool, point).valid, true);
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
test('建物の内外を横切るラインや、負の座標のラインも保存できる', () => {
  const p = createProject();
  const external = newSteelLine(p, [-30000, -4000, -10000], [-25000, 7000, -10000], 'c65');
  p.layouts[0].steelFrames.push(external);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  assert.doesNotThrow(() => newSteelLine(p, [-2000, 1500, 32000], [3000, 1500, 28000], 'c65'));
  assert.doesNotThrow(() => newSteelLine(p, [-5000, 1500, 34000], [-2000, 1500, 40000], 'c65'));
});
test('作業平面のドラッグ位置から、向きごとの作業面座標を更新する', () => {
  const original = structuredClone(DEFAULT_STEEL_LINE_SETTINGS);
  for (const [plane, axis] of [
    ['xz', 1],
    ['xy', 2],
    ['yz', 0],
  ]) {
    const moved = moveSteelPlane({ ...original, plane }, [-21000, -3500, 62000]);
    assert.deepEqual(steelPlaneCenter(moved), [-21000, -3500, 62000]);
    assert.equal(moved.offset, [-21000, -3500, 62000][axis]);
    const origin = [-20000, 50000, 65000],
      direction = [-0.2, -1, -0.3];
    const point = pointOnSteelPlane(origin, direction, moved);
    if (point) assert.equal(point[axis], moved.offset);
  }
  assert.deepEqual(original, DEFAULT_STEEL_LINE_SETTINGS);
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
