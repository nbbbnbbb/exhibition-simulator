import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject } from '../src/domain.js';
import { glazingFrames } from '../src/architecture.js';
import { LightingRig } from '../src/LightingRig.js';
import {
  lightingDefaults,
  solarState,
  compassDirection,
  directSunExposure,
  sampleIlluminance,
} from '../src/lighting.js';

const { building: b, rails } = createProject();
const settings = {
  ...lightingDefaults(),
  date: '2026-12-22',
  minutes: 720,
  southHorizon: 0,
  spots: false,
  rails: false,
  skyLux: 0,
  bouncePercent: 0,
};
const wall = {
  id: 'shadow-wall',
  name: '遮光確認の可動壁',
  railId: 'rail-south-cross',
  s: 4793,
  width: 3000,
  height: 5000,
  thickness: 200,
};
const up = { x: 0, y: 1, z: 0 };

test('太陽方位と影の向きは真北0°・東90°で一周し、朝夕で東西が逆になる', () => {
  for (const [azimuth, name] of [
    [0, '北'],
    [45, '北東'],
    [90, '東'],
    [180, '南'],
    [270, '西'],
    [360, '北'],
    [-90, '西'],
  ])
    assert.equal(compassDirection(azimuth), name);
  const morning = solarState({ ...settings, date: '2026-06-21', minutes: 330 });
  const evening = solarState({ ...settings, date: '2026-06-21', minutes: 1110 });
  assert.equal(compassDirection(morning.azimuth), '北東');
  assert.equal(compassDirection(morning.azimuth + 180), '南西');
  assert.equal(compassDirection(evening.azimuth), '北西');
  assert.equal(compassDirection(evening.azimuth + 180), '南東');
});

test('夏の北窓の朝日・夕日はそれぞれ東向き・西向きの面に当たり、反対面には当たらない', () => {
  const point = { x: 4.5, y: 1, z: 0.7 };
  for (const [minutes, x] of [
    [330, 1],
    [1110, -1],
  ]) {
    const l = { ...settings, date: '2026-06-21', minutes };
    const lit = directSunExposure(point, { x, y: 0, z: 0 }, l, b, [], rails);
    assert.equal(lit.status, 'lit');
    assert.equal(lit.window, 'north');
    assert.ok(lit.lux > 4000);
    const back = directSunExposure(point, { x: -x, y: 0, z: 0 }, l, b, [], rails);
    assert.equal(back.status, 'back-facing');
    assert.equal(back.lux, 0);
  }
});

test('低い冬の日差しは室内奥へ届き、高い夏の日差しは同じ床に届かない', () => {
  const point = { x: 4.5, y: 0.05, z: 37 };
  const winter = directSunExposure(point, up, settings, b, [], rails);
  const summer = directSunExposure(point, up, { ...settings, date: '2026-06-21' }, b, [], rails);
  assert.equal(winter.status, 'lit');
  assert.ok(winter.lux > 20000);
  assert.equal(summer.status, 'occluded');
  assert.equal(summer.lux, 0);
});

test('窓へ到達する前の天井・外壁による影を識別する', () => {
  const roof = directSunExposure(
    { x: 4.5, y: 0.05, z: 44 },
    up,
    { ...settings, date: '2026-06-21' },
    b,
    [],
    rails,
  );
  assert.equal(roof.occluder.kind, 'roof');
  const east = directSunExposure(
    { x: 8.8, y: 1, z: 15 },
    up,
    { ...settings, date: '2026-06-21', minutes: 330 },
    b,
    [],
    rails,
  );
  assert.equal(east.occluder.kind, 'wall');
  assert.equal(east.lux, 0);
});

test('窓の縦枠・横枠が直射を遮り、ガラス部分では通過する（描画と同一形状）', () => {
  const sun = solarState(settings);
  const frames = glazingFrames(b);
  // Compare analytic daylight to ray intersections with the actual Three.js window boxes.
  const meshes = frames.map((f) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(f.width / 1000, f.height / 1000, f.depth / 1000),
    );
    mesh.position.set(f.x / 1000, f.y / 1000, f.z / 1000);
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  try {
    for (const [x, y, blocked] of [
      [4.48, 1, true],
      [4.8, 2.4, true],
      [4.8, 1, false],
    ]) {
      const t = 0.5 / sun.direction.z;
      const point = {
        x: x - sun.direction.x * t,
        y: y - sun.direction.y * t,
        z: b.length / 1000 - 0.5,
      };
      const ray = new THREE.Raycaster(
        new THREE.Vector3(point.x, point.y, point.z),
        new THREE.Vector3(sun.direction.x, sun.direction.y, sun.direction.z),
        0,
        t,
      );
      assert.equal(ray.intersectObjects(meshes).length > 0, blocked);
      const exposure = directSunExposure(point, { x: 0, y: 0, z: 1 }, settings, b, [], rails);
      assert.equal(exposure.status, blocked ? 'occluded' : 'lit');
      if (blocked) {
        assert.equal(exposure.occluder.kind, 'window-frame');
        assert.equal(sampleIlluminance(point, up, settings, b, [], rails).direct, 0);
      }
    }
  } finally {
    meshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  }
});

test('可動壁の影の原因を特定し、移動・幅・高さで影を更新する', () => {
  const point = { x: 4.5, y: 0.05, z: 37 };
  const shadow = directSunExposure(point, up, settings, b, [wall], rails);
  assert.equal(shadow.occluder.kind, 'partition');
  assert.equal(shadow.occluder.partitionId, wall.id);
  assert.equal(shadow.occluder.name, wall.name);
  assert.equal(shadow.lux, 0);
  for (const patch of [{ s: 1500 }, { height: 200 }, { width: 200 }]) {
    const moved = directSunExposure(point, up, settings, b, [{ ...wall, ...patch }], rails);
    assert.equal(moved.status, 'lit');
    assert.ok(moved.lux > 20000);
  }
});

test('可動壁自体の南向きの面は受光し、北向きの裏面は直射を受けない', () => {
  const front = directSunExposure(
    { x: 4.193, y: 0.3, z: 37.933 },
    { x: 0, y: 0, z: 1 },
    settings,
    b,
    [wall],
    rails,
  );
  const back = directSunExposure(
    { x: 4.193, y: 0.3, z: 37.731 },
    { x: 0, y: 0, z: -1 },
    settings,
    b,
    [wall],
    rails,
  );
  assert.equal(front.status, 'lit');
  assert.ok(front.lux > 30000);
  assert.equal(back.status, 'back-facing');
  assert.equal(back.lux, 0);
});

test('周辺建物・夜間・自然光OFFの直射ゼロを区別する', () => {
  const point = { x: 4.5, y: 0.05, z: 37 };
  for (const [patch, status] of [
    [{ southHorizon: 80 }, 'surroundings'],
    [{ minutes: 0 }, 'night'],
    [{ daylight: false }, 'off'],
    [{ glassTransmission: 0 }, 'off'],
  ]) {
    const result = directSunExposure(point, up, { ...settings, ...patch }, b, [], rails);
    assert.equal(result.status, status);
    assert.equal(result.lux, 0);
  }
});

test('3Dの平行光は太陽と同じ方角から届き、時差の変更でも影を再描画する', () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  const renderer = { shadowMap: {} };
  const rig = new LightingRig(scene, renderer, b, rails);
  try {
    for (const l of [
      settings,
      { ...settings, date: '2026-06-21', minutes: 330 },
      { ...settings, date: '2026-06-21', minutes: 1110 },
    ]) {
      rig.update(l);
      const towardSun = rig.sun.position.clone().sub(rig.sun.target.position).normalize();
      const expected = solarState(l).direction;
      assert.ok(
        towardSun.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z)) < 1e-10,
      );
    }
    rig.update(settings);
    renderer.shadowMap.needsUpdate = false;
    rig.update({ ...settings, utcOffset: 8 });
    assert.equal(renderer.shadowMap.needsUpdate, true);
    renderer.shadowMap.needsUpdate = false;
    rig.update({ ...settings, utcOffset: 8, exposureEV: 1 });
    assert.equal(renderer.shadowMap.needsUpdate, false);
  } finally {
    rig.dispose();
  }
});
