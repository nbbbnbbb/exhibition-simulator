import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/domain.js';
import { lightingDefaults, sampleIlluminance } from '../src/lighting.js';
const project = createProject(),
  b = project.building,
  rails = project.rails;
const wall = {
  id: 'shadow-wall',
  name: '遮光確認',
  railId: 'rail-south-cross',
  s: 4793,
  width: 3000,
  height: 5000,
  thickness: 200,
};
const point = { x: 4.5, y: 0.05, z: 37 },
  normal = { x: 0, y: 1, z: 0 };
const settings = {
  ...lightingDefaults(),
  date: '2026-12-22',
  minutes: 720,
  spots: false,
  rails: false,
  bouncePercent: 0,
  southHorizon: 0,
};
test('可動壁が窓からの直射日光を遮り、横へ移動すると日光が通る', () => {
  const l = { ...settings, skyLux: 0 },
    open = sampleIlluminance(point, normal, l, b, [], rails),
    blocked = sampleIlluminance(point, normal, l, b, [wall], rails),
    moved = sampleIlluminance(point, normal, l, b, [{ ...wall, s: 1500 }], rails);
  assert.ok(open.direct > 20000);
  assert.equal(blocked.direct, 0);
  assert.ok(Math.abs(moved.direct - open.direct) < 0.01);
});
test('可動壁は窓からの散乱光も遮り、移動で採光状態が変わる', () => {
  const l = { ...settings, sunPercent: 0 },
    open = sampleIlluminance(point, normal, l, b, [], rails),
    blocked = sampleIlluminance(point, normal, l, b, [wall], rails),
    moved = sampleIlluminance(point, normal, l, b, [{ ...wall, s: 1500 }], rails);
  assert.ok(open.sky > 0);
  assert.ok(blocked.sky < open.sky * 0.5);
  assert.ok(moved.sky > blocked.sky * 2);
});
