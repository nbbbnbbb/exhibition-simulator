import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lightingDefaults,
  solarPosition,
  solarState,
  kelvinRGB,
  sunWindowHit,
  spotCandela,
  fixtureLayout,
  areaFactor,
  railLuminance,
  sampleIlluminance,
  occluderBoxes,
  segmentBox,
  validateLighting,
  skyIlluminationFactor,
  skyBackgroundBlend,
  indirectLux,
} from '../src/lighting.js';
import { DEFAULT_BUILDING as b, createProject, validateProject } from '../src/domain.js';
const close = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} vs ${expected}`);
test('京都の夏至・冬至・春分の正午の太陽高度が妥当で真南を向く', () => {
  const l = lightingDefaults();
  for (const [date, alt] of [
    ['2026-06-21', 78.46],
    ['2026-12-22', 31.58],
    ['2026-03-20', 54.53],
  ]) {
    const s = solarState({ ...l, date });
    close(s.altitude, alt, 0.1);
    assert.ok(Math.abs(s.azimuth - 180) < 3);
    assert.ok(s.direction.z > 0);
    close(Math.hypot(...Object.values(s.direction)), 1);
  }
});
test('JSTの朝夕と真北の座標が一致し、夜間は自然光がゼロ', () => {
  const l = lightingDefaults(),
    early = solarState({ ...l, date: '2026-06-21', minutes: 330 }),
    late = solarState({ ...l, date: '2026-06-21', minutes: 1110 });
  assert.ok(early.altitude > 0 && early.direction.x > 0 && early.direction.z < 0);
  assert.ok(late.altitude > 0 && late.direction.x < 0 && late.direction.z < 0);
  const night = solarState({ ...l, minutes: 0 });
  assert.ok(night.altitude < 0);
  assert.equal(night.normalLux, 0);
  assert.equal(night.skyFactor, 0);
  assert.ok(Number.isFinite(solarPosition('2024-02-29', 720, 34.9868, 135.7662).altitude));
});
test('南側の遮蔽初期値は直射を遮り、高度・率で調整できる', () => {
  const l = { ...lightingDefaults(), date: '2026-06-21' };
  assert.equal(solarState(l).normalLux, 0);
  assert.ok(solarState(l).blocked);
  const clear = solarState({ ...l, southHorizon: 0 });
  assert.ok(clear.normalLux > 50000);
  close(solarState({ ...l, southBlock: 0.5 }).normalLux, clear.normalLux / 2);
  const north = solarState({ ...l, minutes: 330 });
  assert.equal(north.blocked, false);
  assert.ok(north.normalLux > 0);
});
test('閉じた天井・東西の壁からは太陽光が入らず、ガラス窓だけを通る', () => {
  const d = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };
  assert.equal(sunWindowHit({ x: 4, y: 1.5, z: 20 }, d, b), null); // ray hits roof before south glazing
  assert.equal(sunWindowHit({ x: -4, y: 1.5, z: b.length / 1000 - 1 }, d, b), null); // opaque wing south wall
  const hit = sunWindowHit({ x: 4, y: 1.5, z: b.length / 1000 - 1 }, d, b);
  assert.equal(hit.window, 'south');
  close(hit.y, 2.5);
  assert.equal(sunWindowHit({ x: 4, y: 1.5, z: 1 }, { x: 0, y: 0.1, z: -1 }, b).window, 'north');
  assert.equal(sunWindowHit({ x: 4, y: 1.5, z: 20 }, { x: 1, y: 1, z: 0 }, b), null);
});
test('スポットのcdは壁面光軸上の設定照度と逆二乗則に一致', () => {
  const l = lightingDefaults(),
    fixtures = fixtureLayout(b);
  assert.equal(fixtures.spots.length, 10);
  for (const f of fixtures.spots) {
    const delta = {
        x: f.position.x - f.target.x,
        y: f.position.y - f.target.y,
        z: f.position.z - f.target.z,
      },
      r = Math.hypot(...Object.values(delta));
    const cos = (delta.x * f.normal.x + delta.y * f.normal.y + delta.z * f.normal.z) / r;
    close((spotCandela(l, f) * cos) / (r * r), 200);
  }
  assert.equal(spotCandela({ ...l, spots: false }, fixtures.spots[0]), 0);
});
test('レール定常光は基準作業面で設定lxへ校正される', () => {
  const l = lightingDefaults(),
    f = fixtureLayout(b),
    p = { x: b.mainWidth / 2000, y: 0.8, z: (b.length - 8620) / 2000 };
  const factor = f.rails
    .filter((r) => r.position.x > 0)
    .reduce((n, r) => n + areaFactor(p, { x: 0, y: 1, z: 0 }, r), 0);
  close(railLuminance(l, b, f) * factor, 150);
  close(railLuminance({ ...l, railLux: 300 }, b, f), 2 * railLuminance(l, b, f));
});
test('全光源OFFで作品照度はゼロ、画面露出と色温度はlxを変えない', () => {
  const p = { x: 4.4925, y: 0.8, z: 18.556 },
    normal = { x: 0, y: 1, z: 0 },
    l = lightingDefaults();
  const off = sampleIlluminance(
    p,
    normal,
    { ...l, daylight: false, spots: false, rails: false },
    b,
  );
  assert.ok(Object.values(off).every((v) => v === 0));
  close(
    sampleIlluminance(p, normal, l, b).total,
    sampleIlluminance(p, normal, { ...l, exposureEV: 2, railKelvin: 6500, spotKelvin: 1800 }, b)
      .total,
  );
  const warm = kelvinRGB(2700),
    cool = kelvinRGB(9000);
  assert.ok(warm[0] > warm[2]);
  assert.ok(cool[2] > cool[0]);
});
test('可動壁の遮蔽と閉じた構造を照度の概算に含める', () => {
  const rails = [{ id: 'r', x1: 0, z1: 10000, x2: b.mainWidth, z2: 10000 }],
    parts = [{ id: 'p', railId: 'r', s: 4500, width: 3000, height: 5000, thickness: 200 }];
  const boxes = occluderBoxes(b, parts, rails),
    wall = boxes.at(-1);
  assert.ok(segmentBox({ x: 4.5, y: 1.5, z: 8 }, { x: 4.5, y: 1.5, z: 12 }, wall.min, wall.max));
  assert.ok(!segmentBox({ x: 1, y: 1.5, z: 8 }, { x: 1, y: 1.5, z: 12 }, wall.min, wall.max));
});
test('照明の旧JSON移行・プラン別保存・不正値を検証する', () => {
  const p = createProject();
  delete p.layouts[0].lighting;
  validateProject(p);
  assert.equal(p.layouts[0].lighting.spotKelvin, 3000);
  const clone = structuredClone(p.layouts[0]);
  clone.id = 'other';
  clone.lighting.spotKelvin = 6500;
  p.layouts.push(clone);
  validateProject(p);
  assert.equal(p.layouts[0].lighting.spotKelvin, 3000);
  for (const patch of [
    { date: '2026-02-30' },
    { spotLux: NaN },
    { railKelvin: 100000 },
    { minutes: -1 },
    { daylight: 'true' },
    { glassTransmission: 2 },
  ])
    assert.throws(() => validateLighting({ ...lightingDefaults(), ...patch }));
});
test('背景と天空光は日没の前後で連続し、薄明が残る', () => {
  for (const f of [skyIlluminationFactor, skyBackgroundBlend]) {
    assert.ok(Math.abs(f(0.001) - f(-0.001)) < 0.001);
    assert.ok(f(0) > f(-6) && f(-6) > f(-12) && f(-12) > f(-18));
    assert.equal(f(-20), 0);
    let last = 0;
    for (let h = -20; h <= 90; h += 0.1) {
      assert.ok(f(h) >= last - 1e-12);
      last = f(h);
    }
  }
});
test('反射光を強めても光源OFF時はゼロで、夜間も人工光の反射が残る', () => {
  const l = { ...lightingDefaults(), daylight: false, minutes: 0 };
  assert.ok(indirectLux(l) > 60);
  assert.equal(indirectLux({ ...l, bouncePercent: 0 }), 0);
  close(indirectLux({ ...l, bouncePercent: 200 }), indirectLux(l) * 2);
  close(indirectLux(l), indirectLux({ ...l, minutes: 720 }));
  assert.equal(indirectLux({ ...l, spots: false, rails: false }), 0);
});
test('旧照明データに標準の反射光補正を補い、不正値を拒否する', () => {
  const l = lightingDefaults();
  delete l.bouncePercent;
  validateLighting(l);
  assert.equal(l.bouncePercent, 100);
  assert.throws(() => validateLighting({ ...l, bouncePercent: -1 }));
  assert.throws(() => validateLighting({ ...l, bouncePercent: 201 }));
});
