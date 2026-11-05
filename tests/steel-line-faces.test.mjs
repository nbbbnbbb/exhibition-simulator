import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/domain.js';
import { newSteelLine } from '../src/steelLinePlacement.js';
import { detectSteelLineFaces, pruneSteelLineMembranes } from '../src/steelLineFaces.js';
import { makeSteelLineFace } from '../src/SteelLineFaces3D.js';

function loop(points, p = createProject(), prefix = 'l') {
  return points.map((start, i) =>
    newSteelLine(p, start, points[(i + 1) % points.length], 'c65', `${prefix}${i}`),
  );
}
const rectangle = [
  [2000, 1000, 14000],
  [5000, 1000, 14000],
  [5000, 3000, 14000],
  [2000, 3000, 14000],
];
function style(face) {
  return { faceId: face.id, lineIds: face.lineIds, color: '#55aaee', opacity: 0.45 };
}
test('水平・垂直・斜めの閉じた輪郭を自動で面にし、開いた輪郭を除外する', () => {
  for (const points of [
    rectangle,
    rectangle.map(([x, y, z]) => [x, 1500, z + (y - 1000)]),
    rectangle.map(([x, y, z]) => [x, y, z + (x - 2000) * 0.5]),
  ]) {
    const lines = loop(points),
      faces = detectSteelLineFaces(lines);
    assert.equal(faces.length, 1);
    assert.equal(faces[0].points.length, 4);
    assert.ok(faces[0].area >= 6000000);
    assert.equal(detectSteelLineFaces(lines.slice(0, 3)).length, 0);
  }
  const warped = rectangle.map((p) => [...p]);
  warped[3][2] += 100;
  assert.equal(detectSteelLineFaces(loop(warped)).length, 0);
});
test('ボックスの12本のラインから6面を検出し、方向・順序・平行移動で面IDを保持する', () => {
  const p = createProject(),
    vertices = [...rectangle, ...rectangle.map(([x, y, z]) => [x, y, z + 2000])];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const lines = edges.map(([a, b], i) => newSteelLine(p, vertices[a], vertices[b], 'c65', `e${i}`)),
    faces = detectSteelLineFaces(lines);
  assert.equal(faces.length, 6);
  const moved = lines.map((f) => ({ ...f, x: f.x + 500, z: f.z + 1000 })).reverse();
  assert.deepEqual(
    detectSteelLineFaces(moved).map((f) => f.id),
    faces.map((f) => f.id),
  );
  const reversed = lines.map((f) => ({
    ...f,
    x: f.x + f.lineEnd[0],
    y: f.y + f.lineEnd[1],
    z: f.z + f.lineEnd[2],
    lineEnd: f.lineEnd.map((v) => -v),
  }));
  assert.deepEqual(
    detectSteelLineFaces(reversed).map((f) => f.id),
    faces.map((f) => f.id),
  );
});
test('交差・途中の接続で分割された領域を検出し、余分な外周面を作らない', () => {
  const p = createProject(),
    lines = loop(rectangle, p);
  lines.push(newSteelLine(p, [3500, 1000, 14000], [3500, 3000, 14000], 'c65', 'divider'));
  let faces = detectSteelLineFaces(lines);
  assert.equal(faces.length, 2);
  assert.equal(
    faces.reduce((n, f) => n + f.area, 0),
    6000000,
  );
  const diagonal = [
    ...loop(rectangle, p),
    newSteelLine(p, rectangle[0], rectangle[2], 'c65', 'diagonal'),
  ];
  assert.equal(detectSteelLineFaces(diagonal).length, 2);
  const extending = [
    newSteelLine(p, [1500, 1000, 14000], [5500, 1000, 14000], 'c65', 'bottom'),
    newSteelLine(p, [1500, 3000, 14000], [5500, 3000, 14000], 'c65', 'top'),
    newSteelLine(p, [2000, 500, 14000], [2000, 3500, 14000], 'c65', 'left'),
    newSteelLine(p, [5000, 500, 14000], [5000, 3500, 14000], 'c65', 'right'),
  ];
  assert.equal(detectSteelLineFaces(extending).length, 1);
});
test('凹形・内側の穴・開いた尾線・重複部材に対応する', () => {
  const p = createProject(),
    concave = [
      [2000, 1000, 14000],
      [5000, 1000, 14000],
      [5000, 2000, 14000],
      [3500, 2000, 14000],
      [3500, 3000, 14000],
      [2000, 3000, 14000],
    ];
  assert.equal(detectSteelLineFaces(loop(concave, p)).length, 1);
  const outer = loop(rectangle, p),
    inner = loop(
      [
        [3000, 1500, 14000],
        [4000, 1500, 14000],
        [4000, 2500, 14000],
        [3000, 2500, 14000],
      ],
      p,
      'inner',
    );
  const faces = detectSteelLineFaces([...outer, ...inner]);
  assert.equal(faces.length, 2);
  assert.equal(
    faces.reduce((s, f) => s + f.area, 0),
    6000000,
  );
  assert.equal(faces.filter((f) => f.holes.length).length, 1);
  assert.equal(
    detectSteelLineFaces([
      ...outer,
      newSteelLine(p, rectangle[0], [1000, 1000, 14000], 'c65', 'tail'),
    ]).length,
    1,
  );
  assert.equal(detectSteelLineFaces([...outer, { ...outer[0], id: 'duplicate' }]).length, 1);
});
test('凹面と穴のある膜の三角形の面積が実際の領域と一致する', () => {
  const p = createProject(),
    inner = loop(
      [
        [3000, 1500, 14000],
        [4000, 1500, 14000],
        [4000, 2500, 14000],
        [3000, 2500, 14000],
      ],
      p,
      'inner',
    );
  for (const face of detectSteelLineFaces([...loop(rectangle, p), ...inner])) {
    const group = makeSteelLineFace(face, style(face)),
      mesh = group.children.find((o) => o.isMesh),
      coords = mesh.geometry.attributes.position.array;
    let size = 0;
    for (let i = 0; i < coords.length; i += 9) {
      const a = [
          coords[i + 3] - coords[i],
          coords[i + 4] - coords[i + 1],
          coords[i + 5] - coords[i + 2],
        ],
        b = [
          coords[i + 6] - coords[i],
          coords[i + 7] - coords[i + 1],
          coords[i + 8] - coords[i + 2],
        ];
      size +=
        Math.hypot(
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ) / 2;
    }
    assert.ok(Math.abs(size - face.area / 1e6) < 0.00001);
    assert.equal(mesh.material.opacity, 0.45);
    assert.equal(mesh.userData.steelLineMembrane, true);
    assert.equal(makeSteelLineFace(face, null).userData.editorOnly, true);
  }
});
test('面の膜設定のJSON往復・旧データ移行・境界削除・壊れた参照を検証する', () => {
  const p = createProject();
  p.layouts[0].steelFrames = loop(rectangle, p);
  const face = detectSteelLineFaces(p.layouts[0].steelFrames)[0];
  p.layouts[0].steelLineMembranes = [style(face)];
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  const old = createProject();
  delete old.layouts[0].steelLineMembranes;
  validateProject(old);
  assert.deepEqual(old.layouts[0].steelLineMembranes, []);
  const open = structuredClone(p);
  open.layouts[0].steelFrames[0].x += 100;
  validateProject(open);
  assert.equal(detectSteelLineFaces(open.layouts[0].steelFrames).length, 0);
  assert.equal(open.layouts[0].steelLineMembranes.length, 1);
  const broken = structuredClone(p);
  broken.layouts[0].steelLineMembranes[0].lineIds[0] = 'missing';
  assert.throws(() => validateProject(broken));
  p.layouts[0].steelFrames.pop();
  pruneSteelLineMembranes(p);
  assert.deepEqual(p.layouts[0].steelLineMembranes, []);
  validateProject(p);
});
