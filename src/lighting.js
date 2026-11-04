// Solar coordinates: NOAA approximate equations. World: +X east, +Y up, -Z true north.
// Lux values are analytic estimates, not a measured photometric model of the fixtures.
import {
  createRails,
  ceilingStructure,
  structuralBounds,
  spotTrackLayout,
} from './architecture.js';
const PI = Math.PI,
  rad = (d) => (d * PI) / 180,
  deg = (r) => (r * 180) / PI;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v) => Math.hypot(v.x, v.y, v.z);
const unit = (v) => {
  const n = length(v) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
export const LIGHTING_DEFAULTS = {
  date: '2026-11-04',
  minutes: 720,
  latitude: 34.9868,
  longitude: 135.7662,
  utcOffset: 9,
  daylight: true,
  sunPercent: 100,
  sunSoftness: 0.35,
  skyLux: 12000,
  glassTransmission: 0.65,
  southHorizon: 80,
  southStart: 115,
  southEnd: 245,
  southBlock: 1,
  northSky: 0.85,
  southSky: 0.2,
  spots: true,
  spotKelvin: 3000,
  spotLux: 200,
  spotAngle: 48,
  spotSoftness: 0.4,
  rails: true,
  railKelvin: 4000,
  railLux: 150,
  bouncePercent: 100,
  exposureEV: 0,
};
export function lightingDefaults() {
  return { ...LIGHTING_DEFAULTS };
}
export function validateLighting(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) throw new Error('照明データが不正です');
  l.bouncePercent ??= 100;
  const d = new Date(l.date + 'T00:00:00Z');
  if (
    typeof l.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(l.date) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== l.date ||
    d.getUTCFullYear() < 1900 ||
    d.getUTCFullYear() > 2100
  )
    throw new Error('日照の日付は1900〜2100年の有効な日付を指定してください');
  const bounds = {
    minutes: [0, 1439],
    latitude: [-80, 80],
    longitude: [-180, 180],
    utcOffset: [-12, 14],
    sunPercent: [0, 200],
    sunSoftness: [0, 1],
    skyLux: [0, 50000],
    glassTransmission: [0, 1],
    southHorizon: [0, 90],
    southStart: [90, 179],
    southEnd: [181, 270],
    southBlock: [0, 1],
    northSky: [0, 1],
    southSky: [0, 1],
    spotKelvin: [1800, 10000],
    spotLux: [0, 3000],
    spotAngle: [15, 100],
    spotSoftness: [0, 1],
    railKelvin: [1800, 10000],
    railLux: [0, 3000],
    bouncePercent: [0, 200],
    exposureEV: [-3, 3],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (!Number.isFinite(l[key]) || l[key] < min || l[key] > max)
      throw new Error(`照明の値が不正です：${key}`);
  for (const key of ['daylight', 'spots', 'rails'])
    if (typeof l[key] !== 'boolean') throw new Error(`照明スイッチが不正です：${key}`);
  return l;
}
export function solarPosition(date, minutes, latitude, longitude, utcOffset = 9) {
  const d = new Date(date + 'T00:00:00Z'),
    year = d.getUTCFullYear();
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const day = (d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1;
  const g = ((2 * PI) / days) * (day - 1 + (minutes / 60 - 12) / 24);
  const eq =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const trueMinutes = (((minutes + eq + 4 * longitude - 60 * utcOffset) % 1440) + 1440) % 1440;
  const hourAngle = rad(trueMinutes / 4 - 180),
    lat = rad(latitude);
  const altitude = Math.asin(
    clamp(
      Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle),
      -1,
      1,
    ),
  );
  const azimuth =
    (deg(
      Math.atan2(
        Math.sin(hourAngle),
        Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
      ),
    ) +
      180 +
      360) %
    360;
  return {
    altitude: deg(altitude),
    azimuth,
    direction: {
      x: Math.sin(rad(azimuth)) * Math.cos(altitude),
      y: Math.sin(altitude),
      z: -Math.cos(rad(azimuth)) * Math.cos(altitude),
    },
  };
}
const smooth = (t) => t * t * (3 - 2 * t);
// Approximate sky illumination through twilight; the Sun crossing 0 degrees is not a switch.
export function skyIlluminationFactor(altitude) {
  const knots = [
    [-18, 0],
    [-12, 0.000003],
    [-6, 0.0003],
    [0, 0.03],
    [6, 0.18],
    [30, 1],
  ];
  if (altitude <= -18) return 0;
  for (let i = 1; i < knots.length; i++) {
    const [a, x] = knots[i - 1],
      [b, y] = knots[i];
    if (altitude <= b) {
      const t = smooth((altitude - a) / (b - a));
      return x === 0 ? y * t : Math.exp(Math.log(x) * (1 - t) + Math.log(y) * t);
    }
  }
  return 1;
}
export function skyBackgroundBlend(altitude) {
  return smooth(clamp((altitude + 18) / 24, 0, 1));
}
export function solarState(l) {
  const sun = solarPosition(l.date, l.minutes, l.latitude, l.longitude, l.utcOffset);
  const south = sun.azimuth >= l.southStart && sun.azimuth <= l.southEnd;
  const blocked = south && sun.altitude < l.southHorizon;
  const visibility = blocked ? 1 - l.southBlock : 1;
  const clearLux =
    sun.altitude > 0
      ? 90000 * Math.pow(0.7, Math.min(20, 1 / Math.max(0.02, sun.direction.y)) - 1)
      : 0;
  const skyFactor = skyIlluminationFactor(sun.altitude);
  return {
    ...sun,
    blocked,
    visibility,
    normalLux: l.daylight
      ? ((clearLux * l.sunPercent) / 100) * visibility * l.glassTransmission
      : 0,
    skyFactor: l.daylight ? skyFactor : 0,
    window: sun.direction.z < 0 ? 'north' : 'south',
  };
}
export function kelvinRGB(k) {
  const t = clamp(k, 1800, 10000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((n) => clamp(n, 0, 255) / 255);
}
export function fixtureLayout(b, partitionRails = createRails(b)) {
  const W = b.mainWidth / 1000,
    L = b.length / 1000,
    west = (b.mainWidth - b.overallWidth) / 1000,
    j = (b.length - b.wingDepth) / 1000;
  const tracks = spotTrackLayout(b);
  const mount = (spineId, z) => {
    const track = tracks.find((t) => t.spineId === spineId && z * 1000 >= t.z1 && z * 1000 <= t.z2);
    return {
      trackId: track.id,
      mountPoint: { x: track.x / 1000, y: track.y / 1000, z },
      position: { x: track.x / 1000, y: track.y / 1000 - 0.13, z },
    };
  };
  const spots = [];
  for (let i = 0; i < 4; i++) {
    const z = 2.5 + ((L - 5) * (i + 0.5)) / 4;
    for (const side of [0, 1])
      spots.push({
        id: `main-${i}-${side}`,
        ...mount(side ? 'main-right' : 'main-left', z),
        target: { x: side ? W : 0, y: 1.5, z },
        normal: { x: side ? -1 : 1, y: 0, z: 0 },
      });
  }
  spots.push({
    id: 'wing-north',
    ...mount('wing', j + 3.5),
    target: { x: west, y: 1.5, z: j + 3.5 },
    normal: { x: 1, y: 0, z: 0 },
  });
  const south = mount('wing', L - 2);
  spots.push({
    id: 'wing-south',
    ...south,
    target: { x: south.position.x, y: 1.5, z: L },
    normal: { x: 0, y: 0, z: -1 },
  });
  const rails = tracks.map((t) => ({
    trackId: t.id,
    position: { x: t.x / 1000, y: t.y / 1000 - 0.032, z: (t.z1 + t.z2) / 2000 },
    width: 0.045,
    height: (t.z2 - t.z1) / 1000,
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 1 },
    normal: { x: 0, y: -1, z: 0 },
  }));
  return { spots, rails, tracks };
}
// Midpoint integration is shared by the illuminance readout and area-light calibration.
export function areaFactor(point, normal, area, visible = () => true) {
  let result = 0;
  const n = 12;
  for (let i = 0; i < n; i++)
    for (const t of [-0.25, 0.25]) {
      const source = {
        x:
          area.position.x +
          area.u.x * area.width * t +
          area.v.x * area.height * ((i + 0.5) / n - 0.5),
        y:
          area.position.y +
          area.u.y * area.width * t +
          area.v.y * area.height * ((i + 0.5) / n - 0.5),
        z:
          area.position.z +
          area.u.z * area.width * t +
          area.v.z * area.height * ((i + 0.5) / n - 0.5),
      };
      const delta = sub(source, point),
        d = length(delta),
        dir = unit(delta);
      const receiver = Math.max(0, dot(normal, dir)),
        emitter = Math.max(0, -dot(area.normal, dir));
      if (receiver && emitter && visible(source))
        result += (((receiver * emitter) / (d * d)) * area.width * area.height) / (n * 2);
    }
  return result;
}
export function railLuminance(l, b, fixtures = fixtureLayout(b)) {
  const p = { x: b.mainWidth / 2000, y: 0.8, z: (b.length - 8620) / 2000 };
  const main = fixtures.rails.filter((a) => a.position.x > 0);
  const factor = main.reduce((n, a) => n + areaFactor(p, { x: 0, y: 1, z: 0 }, a), 0);
  return l.rails && factor > 0 ? l.railLux / factor : 0;
}
export function spotCandela(l, fixture) {
  const delta = sub(fixture.position, fixture.target),
    r = length(delta),
    cos = Math.max(0.05, dot(fixture.normal, unit(delta)));
  return l.spots ? (l.spotLux * r * r) / cos : 0;
}
export function windowAreas(b, l, sun = solarState(l)) {
  return [
    { id: 'north', z: 0, normal: { x: 0, y: 0, z: 1 }, visibility: l.northSky },
    { id: 'south', z: b.length / 1000, normal: { x: 0, y: 0, z: -1 }, visibility: l.southSky },
  ].map((w) => ({
    ...w,
    position: { x: b.mainWidth / 2000, y: b.height / 2000, z: w.z },
    width: b.mainWidth / 1000,
    height: b.height / 1000,
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 1, z: 0 },
    luminance: (l.skyLux / PI) * l.glassTransmission * w.visibility * sun.skyFactor,
  }));
}
export const SKY_SCATTER_LIGHT = { fraction: 0.65, angle: 75, penumbra: 0.8 };
// Window-area fill + a broad shadow-casting component: inexpensive diffuse-light occlusion.
// Match the previous area irradiance at an unoccluded work-plane point 3 m from each window.
export function windowScatterCandela(area) {
  const point = { x: area.position.x, y: 0.8, z: area.position.z + area.normal.z * 3 };
  const delta = sub(area.position, point),
    distance = length(delta),
    towardSource = unit(delta);
  const cosine = dot(area.normal, unit(sub(point, area.position)));
  const outer = Math.cos(rad(SKY_SCATTER_LIGHT.angle)),
    inner = Math.cos(rad(SKY_SCATTER_LIGHT.angle * (1 - SKY_SCATTER_LIGHT.penumbra)));
  const cone = smooth(clamp((cosine - outer) / (inner - outer), 0, 1));
  const targetLux =
    area.luminance * areaFactor(point, { x: 0, y: 1, z: 0 }, area) * SKY_SCATTER_LIGHT.fraction;
  return (targetLux * distance * distance) / Math.max(0.0001, towardSource.y * cone);
}
export function reflectedLight(l, sun = solarState(l)) {
  const factor = (l.bouncePercent ?? 100) / 100;
  return {
    rail: (l.rails ? l.railLux * 0.28 : 0) * factor,
    spot: (l.spots ? l.spotLux * 0.1 : 0) * factor,
    sky:
      l.skyLux * sun.skyFactor * l.glassTransmission * (l.northSky + l.southSky) * 0.001 * factor,
    sun: sun.normalLux * Math.abs(sun.direction.z) * 0.001 * factor,
  };
}
export function indirectLux(l, sun = solarState(l)) {
  return Object.values(reflectedLight(l, sun)).reduce((sum, n) => sum + n, 0);
}
export function sunWindowHit(point, d, b) {
  if (d.y <= 0 || Math.abs(d.z) < 1e-8) return null;
  const z = d.z < 0 ? 0 : b.length / 1000,
    t = (z - point.z) / d.z;
  if (t <= 0) return null;
  const x = point.x + d.x * t,
    y = point.y + d.y * t;
  if (x < 0 || x > b.mainWidth / 1000 || y < 0 || y > b.height / 1000) return null;
  return { x, y, z, window: d.z < 0 ? 'north' : 'south' };
}
export function segmentBox(a, b, min, max) {
  let lo = 0,
    hi = 1;
  for (const key of ['x', 'y', 'z']) {
    const delta = b[key] - a[key];
    if (Math.abs(delta) < 1e-10) {
      if (a[key] < min[key] || a[key] > max[key]) return false;
      continue;
    }
    const t1 = (min[key] - a[key]) / delta,
      t2 = (max[key] - a[key]) / delta;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return false;
  }
  return hi > 1e-4 && lo < 0.9999;
}
export function occluderBoxes(b, partitions = [], rails = createRails(b)) {
  const W = b.mainWidth / 1000,
    L = b.length / 1000,
    H = b.height / 1000,
    west = (b.mainWidth - b.overallWidth) / 1000,
    j = (b.length - b.wingDepth) / 1000;
  const box = (x1, y1, z1, x2, y2, z2) => ({
    min: { x: x1, y: y1, z: z1 },
    max: { x: x2, y: y2, z: z2 },
  });
  const boxes = [
    box(-0.006, 0, 0, 0.006, H, j),
    box(W - 0.006, 0, 0, W + 0.006, H, L),
    box(west - 0.006, 0, j, west + 0.006, H, L),
    box(west, 0, j - 0.006, 0, H, j + 0.006),
    box(west, 0, L - 0.006, 0, H, L + 0.006),
    box(-b.columnSize / 1000, 0, L - 4.97 - b.columnSize / 1000, 0, H, L - 4.97),
    box(west, b.mezzanineHeight / 1000 - 0.14, j, 0, b.mezzanineHeight / 1000 + 0.14, L - 4.97),
    box(0, b.mezzanineHeight / 1000 - 0.14, L - 8.62, W, b.mezzanineHeight / 1000 + 0.14, L - 4.97),
  ];
  for (const member of ceilingStructure(b, rails).members) boxes.push(structuralBounds(member));
  for (const p of partitions) {
    const r = rails.find((r) => r.id === p.railId);
    if (!r) continue;
    const vertical = r.x1 === r.x2;
    const distance = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const x = (r.x1 + ((r.x2 - r.x1) / distance) * p.s) / 1000,
      z = (r.z1 + ((r.z2 - r.z1) / distance) * p.s) / 1000;
    const hx = (vertical ? p.thickness : p.width) / 2000,
      hz = (vertical ? p.width : p.thickness) / 2000;
    boxes.push(box(x - hx, 0, z - hz, x + hx, p.height / 1000, z + hz));
  }
  return boxes;
}
export function sampleIlluminance(point, normal, l, b, partitions = [], rails = createRails(b)) {
  const sun = solarState(l),
    fixtures = fixtureLayout(b, rails),
    boxes = occluderBoxes(b, partitions, rails);
  const visible = (target) => !boxes.some((box) => segmentBox(point, target, box.min, box.max));
  let spot = 0;
  for (const f of fixtures.spots) {
    const delta = sub(f.position, point),
      r = length(delta),
      dir = unit(delta),
      axis = unit(sub(f.target, f.position));
    const cosine = dot(axis, unit(sub(point, f.position))),
      outer = Math.cos(rad(l.spotAngle / 2)),
      inner = Math.cos(rad((l.spotAngle / 2) * (1 - l.spotSoftness)));
    let cone = clamp((cosine - outer) / Math.max(1e-8, inner - outer), 0, 1);
    cone = cone * cone * (3 - 2 * cone);
    if (cone && visible(f.position))
      spot += (spotCandela(l, f) * Math.max(0, dot(normal, dir)) * cone) / (r * r);
  }
  const rail =
    railLuminance(l, b, fixtures) *
    fixtures.rails.reduce((n, a) => n + areaFactor(point, normal, a, visible), 0);
  const sky = windowAreas(b, l, sun).reduce(
    (n, a) => n + a.luminance * areaFactor(point, normal, a, visible),
    0,
  );
  const hit = sunWindowHit(point, sun.direction, b);
  const direct = hit && visible(hit) ? sun.normalLux * Math.max(0, dot(normal, sun.direction)) : 0;
  const indirect = indirectLux(l, sun) * (0.25 + (0.75 * (1 - clamp(normal.y, -1, 1))) / 2);
  return { spot, rail, sky, direct, indirect, total: spot + rail + sky + direct + indirect };
}
