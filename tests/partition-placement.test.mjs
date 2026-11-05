import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, partitionGeometry } from '../src/domain.js';
import { pickPartitionRail, previewPartition } from '../src/partitionPlacement.js';

test('指したラインを距離で選び、水平・垂直・反転ラインの起点距離を求める', () => {
  const rails = [
    { id: 'horizontal', x1: 0, z1: 1000, x2: 8000, z2: 1000 },
    { id: 'vertical', x1: 4000, z1: 0, x2: 4000, z2: 12000 },
    { id: 'reversed', x1: 8000, z1: 9000, x2: 0, z2: 9000 },
  ];
  assert.deepEqual(pickPartitionRail(rails, { x: 3200, z: 1010 }, 20), {
    railId: 'horizontal',
    s: 3200,
    distance: 10,
  });
  assert.deepEqual(pickPartitionRail(rails, { x: 4008, z: 6500 }, 20), {
    railId: 'vertical',
    s: 6500,
    distance: 8,
  });
  assert.deepEqual(pickPartitionRail(rails, { x: 2500, z: 9000 }, 20), {
    railId: 'reversed',
    s: 5500,
    distance: 0,
  });
  assert.equal(pickPartitionRail(rails, { x: 2000, z: 4000 }, 20), null);
  assert.equal(pickPartitionRail(rails, { x: -1000, z: 1000 }, 20), null);
  assert.equal(pickPartitionRail(rails, { x: NaN, z: 1000 }, 20), null);
});

test('プレビューはプロジェクトを変更せず、10 mm・Altの1 mm単位で配置する', () => {
  const project = createProject();
  const before = structuredClone(project);
  const candidate = { railId: 'rail-cross-3', s: 3204.3 };
  const preview = previewPartition(project, candidate);
  assert.equal(preview.valid, true);
  assert.equal(preview.partition.s, 3200);
  assert.equal(preview.partition.width, 3000);
  assert.equal(preview.partition.height, 5000);
  assert.equal(preview.partition.thickness, 200);
  assert.equal(previewPartition(project, candidate, true).partition.s, 3204);
  assert.deepEqual(project, before);
});

test('壁の幅をライン内に収め、指した縦ラインの向きに合わせる', () => {
  const project = createProject();
  assert.equal(previewPartition(project, { railId: 'rail-cross-3', s: 5 }).partition.s, 1500);
  const result = previewPartition(project, { railId: 'rail-centre', s: 20000 });
  assert.equal(result.valid, true);
  assert.equal(partitionGeometry(result.partition, project.rails).tangent.x, 0);
  const rail = project.rails.find((r) => r.id === 'rail-cross-3');
  assert.equal(
    previewPartition(project, { railId: rail.id, s: 100000 }).partition.s,
    rail.x2 - rail.x1 - 1500,
  );
});

test('短すぎるライン・天井高不足は赤いプレビュー用の無効結果となり、ライン外は消える', () => {
  const project = createProject();
  project.rails.push({ id: 'short', x1: 2000, z1: 6000, x2: 4000, z2: 6000 });
  assert.equal(previewPartition(project, { railId: 'short', s: 1000 }).valid, false);
  project.building.height = 4500;
  const low = previewPartition(project, { railId: 'rail-cross-3', s: 4000 });
  assert.equal(low.valid, false);
  assert.ok(low.partition);
  assert.match(low.message, /天井高/);
  for (const candidate of [
    null,
    { railId: 'missing', s: 4000 },
    { railId: 'rail-cross-3', s: NaN },
  ]) {
    assert.equal(previewPartition(project, candidate).partition, null);
    assert.equal(previewPartition(project, candidate).valid, false);
  }
});
