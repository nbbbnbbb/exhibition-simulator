import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/domain.js';
import {
  FRAME_SHAPES,
  STEEL_SECTIONS,
  newSteelFrame,
  frameGeometry,
  validateFrame,
  validateFrameShape,
  validateSteelSection,
  sectionLoops,
  sectionRadius,
} from '../src/steelFrames.js';
import { makeSteelFrame } from '../src/SteelFrames3D.js';
import { Box3, Vector3 } from 'three';

test('旧プロジェクトに空のフレームとライブラリを補完し、既存配置を保持する', () => {
  const p = createProject(),
    before = structuredClone(p.layouts[0].placements);
  delete p.frameShapes;
  delete p.steelSections;
  delete p.layouts[0].steelFrames;
  validateProject(p);
  assert.deepEqual(p.frameShapes, []);
  assert.deepEqual(p.steelSections, []);
  assert.deepEqual(p.layouts[0].steelFrames, []);
  assert.deepEqual(p.layouts[0].placements, before);
});
test('全プリセットの部材・面が成立し、3Dを実寸で生成する', () => {
  const p = createProject();
  for (const shape of FRAME_SHAPES) {
    validateFrameShape(shape);
    const f = newSteelFrame(p, shape.id),
      g = makeSteelFrame(f, p);
    assert.equal(g.children.filter((o) => o.userData.steelMember).length, shape.members.length);
    for (const mesh of g.children.filter((o) => o.userData.steelMember)) {
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
      mesh.geometry.computeBoundingBox();
      assert.ok(mesh.geometry.boundingBox.max.z > 0);
    }
    assert.equal(g.position.x, f.x / 1000);
    const actual = new Box3();
    g.updateMatrixWorld(true);
    g.children
      .filter((o) => o.userData.steelMember)
      .forEach((o) => actual.union(new Box3().setFromObject(o, true)));
    const extent = actual.getSize(new Vector3());
    assert.ok(Math.abs(extent.x * 1000 - f.width) < 0.01);
    assert.ok(Math.abs(extent.y * 1000 - f.height) < 0.01);
    if (f.depth) assert.ok(Math.abs(extent.z * 1000 - f.depth) < 0.01);
    assert.ok(Math.abs(actual.min.y - f.y / 1000) < 0.00001);
    assert.equal(f.depth, shape.id === 'box' ? 2000 : 0);
  }
});
test('C/U/Lと中空角パイプを実際の断面輪郭から作る', () => {
  for (const s of STEEL_SECTIONS) assert.ok(sectionRadius(s) > 0);
  assert.equal(sectionLoops(STEEL_SECTIONS.find((s) => s.kind === 'tube')).length, 2);
  assert.equal(sectionLoops(STEEL_SECTIONS.find((s) => s.kind === 'c'))[0].length, 12);
});
test('回転と移動が全頂点・膜に追従し、ボックスの全6面を描画する', () => {
  const p = createProject(),
    f = newSteelFrame(p, 'box');
  f.rotation = 90;
  f.y = 500;
  f.membrane.faces = [0, 1, 2, 3, 4, 5];
  validateFrame(f, p);
  const { nodes, local } = frameGeometry(f, p);
  assert.ok(Math.abs(nodes[0][0] - (f.x + local[0][2])) < 1e-8);
  assert.ok(Math.abs(nodes[0][2] - (f.z - local[0][0])) < 1e-8);
  assert.equal(nodes[0][1], f.y + local[0][1]);
  const g = makeSteelFrame(f, p);
  assert.equal(g.children.filter((o) => o.userData.steelMembrane).length, 6);
  const membrane = g.children.find((o) => o.userData.steelMembrane);
  assert.equal(membrane.material.opacity, 0.35);
  assert.equal(membrane.geometry.attributes.position.count, 6);
});
test('建物外・回転後のはみ出し・天井越え・断面より小さい外寸を拒否する', () => {
  const p = createProject(),
    f = newSteelFrame(p, 'rectangle');
  p.steelSections.push({
    id: 'wide',
    name: '大きな独自断面',
    kind: 'custom',
    points: [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ],
  });
  for (const changes of [
    { x: 0 },
    { z: -100 },
    { y: 4000 },
    { width: 100, sectionId: 'wide', height: 100 },
    { rotation: NaN },
    { width: Infinity },
    { depth: 20 },
  ]) {
    assert.throws(() => validateFrame({ ...f, ...changes }, p));
  }
  assert.throws(() => validateFrame({ ...f, x: 500, rotation: 45 }, p), /範囲外/);
  assert.doesNotThrow(() => validateFrame({ ...f, rotation: 90 }, p));
});
test('L字の入り隅をまたぐ部材を、両端が建物内でも拒否する', () => {
  const p = createProject();
  const shape = {
    id: 'corner',
    name: '入り隅試験',
    nodes: [
      [0, 0, 0],
      [5000, 0, -5000],
      [5000, 1000, -5000],
      [0, 1000, 0],
    ],
    members: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    faces: [],
  };
  p.frameShapes.push(validateFrameShape(shape));
  const f = {
    ...newSteelFrame(p, 'box'),
    shapeId: 'corner',
    x: 500,
    z: 30200,
    width: 5000,
    depth: 5000,
    height: 1000,
  };
  assert.throws(() => validateFrame(f, p), /範囲外/);
});
test('独自の台形を登録し、異なる寸法に拡縮してJSONで往復する', () => {
  const p = createProject();
  const shape = {
    id: 'trapezoid',
    name: '台形',
    nodes: [
      [0, 0, 0],
      [3000, 0, 0],
      [2400, 2000, 0],
      [600, 2000, 0],
    ],
    members: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    faces: [{ name: '台形膜', nodes: [0, 1, 2, 3] }],
  };
  p.frameShapes.push(validateFrameShape(shape));
  const section = {
    id: 'custom-l',
    name: '独自L断面',
    kind: 'custom',
    points: [
      [-20, -20],
      [20, -20],
      [20, -18],
      [-18, -18],
      [-18, 20],
      [-20, 20],
    ],
  };
  p.steelSections.push(validateSteelSection(section));
  const f = newSteelFrame(p, shape.id);
  f.sectionId = section.id;
  f.width = 4000;
  f.membrane = { faces: [0], color: '#112233', opacity: 0.62 };
  p.layouts[0].steelFrames.push(f);
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored, p);
  assert.equal(makeSteelFrame(f, p).children.filter((o) => o.userData.steelMembrane).length, 1);
});
test('不正な形状・面・断面・参照・重複IDを拒否する', () => {
  const shape = structuredClone(FRAME_SHAPES[0]);
  for (const change of [
    { members: [[0, 100]] },
    { members: [[0, 0]] },
    {
      members: [
        [0, 1],
        [1, 0],
      ],
    },
    { faces: [{ name: '面', nodes: [0, 2, 1, 3] }] },
    { faces: [{ name: '面', nodes: [0, 0, 1] }] },
    {
      members: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    },
  ])
    assert.throws(() => validateFrameShape({ ...shape, ...change }));
  const box = structuredClone(FRAME_SHAPES[1]);
  box.faces = [{ name: 'ねじれ', nodes: [0, 1, 2, 7] }];
  assert.throws(() => validateFrameShape(box), /同一平面/);
  assert.throws(() =>
    validateSteelSection({
      id: 'x',
      name: '交差',
      kind: 'custom',
      points: [
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ],
    }),
  );
  const p = createProject(),
    f = newSteelFrame(p, 'rectangle');
  p.layouts[0].steelFrames = [f];
  for (const change of [
    { shapeId: 'missing' },
    { sectionId: 'missing' },
    { membrane: { faces: [9], color: '#ffffff', opacity: 0.5 } },
    { membrane: { faces: [0, 0], color: '#ffffff', opacity: 0.5 } },
    { membrane: { faces: [], color: 'bad', opacity: 0.5 } },
  ])
    assert.throws(() => validateFrame({ ...f, ...change }, p));
  p.layouts[0].steelFrames.push(structuredClone(f));
  assert.throws(() => validateProject(p), /一覧/);
});
test('プランを複製した後のフレームと膜は独立している', () => {
  const p = createProject(),
    f = newSteelFrame(p, 'box');
  f.membrane.faces = [0];
  p.layouts[0].steelFrames.push(f);
  const copy = structuredClone(p.layouts[0]);
  copy.id = 'layout-copy';
  copy.steelFrames[0].x += 500;
  copy.steelFrames[0].membrane.faces.push(1);
  p.layouts.push(copy);
  validateProject(p);
  assert.deepEqual(f.membrane.faces, [0]);
  assert.equal(copy.steelFrames[0].x - f.x, 500);
});
