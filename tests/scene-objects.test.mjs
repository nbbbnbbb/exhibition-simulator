import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { createProject, validateProject } from '../src/domain.js';
import {
  newSceneObject,
  validateSceneObject,
  validateOutline,
  objectFootprint,
  silhouettes,
  OBJECT_KINDS,
} from '../src/sceneObjects.js';
import { makeSceneObject } from '../src/SceneObjects3D.js';
import { pickContextObject } from '../src/objectPicking.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
test('既存プロジェクトを読み込め、新しい配置は全プランとJSONに保存される', () => {
  const p = createProject();
  delete p.layouts[0].sceneObjects;
  validateProject(p);
  assert.deepEqual(p.layouts[0].sceneObjects, []);
  const object = newSceneObject('table', p.building);
  p.layouts[0].sceneObjects.push(object);
  p.layouts.push({ ...structuredClone(p.layouts[0]), id: 'second' });
  p.layouts[1].sceneObjects[0].width = 2000;
  const reloaded = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(reloaded.layouts[0].sceneObjects[0].width, 1000);
  assert.equal(reloaded.layouts[1].sceneObjects[0].width, 2000);
  p.layouts[0].sceneObjects.push(object);
  assert.throws(() => validateProject(p), /ID/);
});

test('分割した11人それぞれに元の輪郭があり、SVGも個別に書き出されている', async () => {
  assert.equal(silhouettes.length, 11);
  assert.equal(new Set(silhouettes.map((s) => s.sourceId)).size, 11);
  for (const s of silhouettes) {
    assert.ok(s.points.length > 80);
    close(Math.min(...s.points.map((p) => p[0])), 0);
    close(Math.max(...s.points.map((p) => p[0])), s.aspect);
    close(Math.min(...s.points.map((p) => p[1])), 0);
    close(Math.max(...s.points.map((p) => p[1])), 1);
    const svg = await fs.readFile(
      new URL(`../public/silhouettes/${s.id}.svg`, import.meta.url),
      'utf8',
    );
    assert.equal((svg.match(/<polygon/g) || []).length, 1);
    assert.ok(svg.includes('fill="#808080"'));
  }
});

test('人物は全種類・複数の身長で足元0、縦横比固定、グレー半透明の背景なしメッシュになる', () => {
  for (const s of silhouettes)
    for (const height of [1200, 1700, 1950]) {
      const object = newSceneObject('silhouette', createProject().building, {
        silhouetteId: s.id,
        height,
        x: 0,
        z: 0,
        y: 500,
      });
      assert.equal(object.y, 0);
      assert.equal(object.color, '#808080');
      assert.equal(object.width, Math.round(s.aspect * height));
      const group = makeSceneObject(object),
        mesh = group.children[0];
      const bounds = new THREE.Box3().setFromObject(group);
      close(bounds.min.y, 0);
      close(bounds.max.y, height / 1000);
      close(bounds.max.x - bounds.min.x, (s.aspect * height) / 1000);
      assert.equal(mesh.geometry.type, 'ShapeGeometry');
      assert.equal(mesh.material.opacity, 0.5);
      assert.equal(mesh.material.depthWrite, false);
      assert.equal(mesh.material.side, THREE.DoubleSide);
      assert.equal(group.children.length, 1);
    }
});

test('ボックス・机・円柱・楕円体・多角形の実寸と底面高さが3Dジオメトリに一致する', () => {
  for (const [kind] of OBJECT_KINDS.filter(([kind]) => kind !== 'plane')) {
    const object = newSceneObject(kind, createProject().building, {
      x: 0,
      y: 200,
      z: 0,
      width: 1800,
      height: 950,
      depth: 800,
    });
    const group = makeSceneObject(object);
    const box = new THREE.Box3().setFromObject(group),
      size = box.getSize(new THREE.Vector3());
    close(box.min.y, 0.2);
    close(size.x, 1.8);
    close(size.y, 0.95);
    close(size.z, 0.8);
    if (kind === 'table') assert.equal(group.children.length, 5);
  }
});

test('水平面と垂直面は正しい寸法・高さで配置される', () => {
  for (const orientation of ['vertical', 'horizontal']) {
    const object = newSceneObject('plane', createProject().building, {
      orientation,
      x: 0,
      y: 500,
      z: 0,
      width: 1800,
      height: 950,
      depth: 800,
    });
    const bounds = new THREE.Box3().setFromObject(makeSceneObject(object)),
      size = bounds.getSize(new THREE.Vector3());
    close(bounds.min.y, 0.5);
    close(size.x, 1.8);
    close(size.y, orientation === 'vertical' ? 0.95 : 0);
    close(size.z, orientation === 'horizontal' ? 0.8 : 0);
  }
});

test('平面図の回転と寸法は3Dの座標に一致し、多角形の凹みも保持される', () => {
  const o = newSceneObject('box', createProject().building, {
    x: -1500,
    z: 1200,
    width: 2000,
    depth: 1000,
    rotation: 90,
  });
  const points = objectFootprint(o);
  close(Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])), 1000);
  close(Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])), 2000);
  const polygon = newSceneObject('polygon', createProject().building, { x: 0, z: 0 });
  const group = makeSceneObject(polygon);
  group.updateMatrixWorld(true);
  const hit = (x, z) =>
    new THREE.Raycaster(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0)).intersectObject(
      group,
      true,
    );
  assert.ok(hit(-0.25, 0.25).length > 0);
  assert.equal(hit(0.25, 0.25).length, 0);
});

test('不正な寸法、NaN、未知の人物、交差した輪郭、巨大なデータを受け付けない', () => {
  const object = newSceneObject('box', createProject().building);
  for (const changes of [
    { width: 0 },
    { height: NaN },
    { x: Infinity },
    { y: -1 },
    { opacity: 2 },
    { color: 'red' },
    { name: '' },
    { kind: 'silhouette', silhouetteId: 'unknown' },
  ])
    assert.throws(() => validateSceneObject({ ...object, ...changes }));
  for (const outline of [
    [],
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ],
    [
      [0, 0],
      [0.5, 0],
      [1, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ],
  ])
    assert.throws(() => validateOutline(outline));
  const p = createProject();
  p.layouts[0].sceneObjects = Array.from({ length: 1001 }, (_, i) => ({
    ...object,
    id: String(i),
  }));
  assert.throws(() => validateProject(p));
});

test('半透明の人物・形状を選択でき、壁の裏側にある配置は選ばない', () => {
  const object = newSceneObject('box', createProject().building, { x: 0, z: 0, opacity: 0.3 });
  const group = makeSceneObject(object, true);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.5, 3), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObject(group, true);
  assert.deepEqual(pickContextObject(hits, []), { type: 'scene-object', id: object.id });
  assert.equal(
    pickContextObject(
      [{ distance: 1, object: { userData: {}, material: { colorWrite: true } } }, ...hits],
      [],
    ),
    null,
  );
  assert.ok(group.children.some((o) => o.userData.editorOnly));
  const bounds = new THREE.Box3().setFromObject(group);
  close(bounds.min.y, 0);
  close(bounds.max.y, 1);
});
