import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUILDING as b,
  createProject,
  validateProject,
  walls,
  polygon,
  positionOnWall,
  fitPlacement,
  distribute,
  layoutIssues,
  isWalkable,
  fitPartition,
  partitionGeometry,
  partitionFaces,
  createRails,
} from '../src/domain.js';

test('図面の採用寸法と左寸法列の合計が一致する', () => {
  assert.equal(b.length, 27035 + 2057 + 2000 + 9670 + 4970);
  assert.equal(b.wingDepth, 9670 + 4970);
  assert.equal(b.overallWidth - b.mainWidth, 10175);
  assert.equal(b.length - (4750 + 1500 + 36720), 2762);
  assert.equal(b.overallWidth - b.mainWidth - 10042, 133);
  assert.deepEqual(polygon(b), [
    [0, 0],
    [8985, 0],
    [8985, 45732],
    [-10175, 45732],
    [-10175, 31092],
    [0, 31092],
  ]);
});
test('扉は壁面から切り取られ、壁面起点と長さが正確', () => {
  const w = walls(b);
  assert.equal(w.find((w) => w.id === 'west').length, 27035);
  assert.equal(w.find((w) => w.id === 'west-return').start.z, 29092);
  assert.equal(w.find((w) => w.id === 'west-return').length, 2000);
  assert.equal(w.find((w) => w.id === 'east').start.z, 6250);
  assert.ok(w.every((w) => Math.abs(w.normal.x * w.tangent.x + w.normal.z * w.tangent.z) < 1e-12));
});
test('壁面ローカル座標から実寸の世界座標へ変換', () => {
  const a = createProject().artworks[0],
    w = walls(b).find((w) => w.id === 'west');
  const pos = positionOnWall(w, 6000, 950, a);
  assert.equal(pos.y, 1500);
  assert.equal(pos.z, 6000);
  assert.equal(pos.x, 25.5);
  assert.equal(pos.rotation, Math.PI / 2);
  const e = walls(b).find((w) => w.id === 'east');
  assert.equal(positionOnWall(e, 12000, 1000, a).z, 18250);
});
test('作品の端と床・天井を正確にクランプする', () => {
  const a = createProject().artworks[0];
  assert.deepEqual(fitPlacement({ wallId: 'west', s: -999, bottom: -200 }, a, b), {
    wallId: 'west',
    s: 450,
    bottom: 0,
  });
  const p = fitPlacement({ wallId: 'west', s: 99999, bottom: 99999 }, a, b);
  assert.equal(p.s, 27035 - 450);
  assert.equal(p.bottom, 5500 - 1100);
  const odd = fitPlacement({ wallId: 'west', s: 99999, bottom: 0 }, { ...a, width: 901 }, b);
  assert.equal(odd.s, 26584);
  assert.ok(odd.s + 901 / 2 <= 27035);
  assert.throws(() => fitPlacement({ wallId: 'south', s: 1000, bottom: 0 }, a, b), /展示可能/);
  assert.throws(
    () => fitPlacement({ wallId: 'west', s: 1000, bottom: 0 }, { ...a, width: 28000 }, b),
    /収まり/,
  );
});
test('等間隔は作品幅が異なっても端から端が同じになる', () => {
  const arts = [
    { id: 'a', width: 1000 },
    { id: 'b', width: 500 },
    { id: 'c', width: 2000 },
  ];
  const ps = [
    { id: '1', artworkId: 'a', wallId: 'w', s: 1000 },
    { id: '2', artworkId: 'b', wallId: 'w', s: 3000 },
    { id: '3', artworkId: 'c', wallId: 'w', s: 7000 },
  ];
  const r = distribute(ps, arts, ['1', '2', '3']);
  assert.equal(r[0].s, 1000);
  assert.equal(r[2].s, 7000);
  const gap1 = r[1].s - 250 - r[0].s - 500,
    gap2 = r[2].s - 1000 - r[1].s - 250;
  assert.equal(gap1, gap2);
  assert.equal(gap1, 2000);
  const fixed = distribute(ps, arts, ['1', '2', '3'], 500);
  assert.deepEqual(
    fixed.map((p) => p.s),
    [1000, 2250, 4000],
  );
  assert.throws(
    () => distribute([{ ...ps[0] }, { ...ps[1], wallId: 'other' }], arts, ['1', '2']),
    /同じ壁面/,
  );
});
test('高さ方向も含めて作品の重なりを検出する', () => {
  const p = createProject();
  assert.deepEqual(layoutIssues(p), []);
  p.layouts[0].placements[1].s = 6000;
  assert.equal(layoutIssues(p).length, 1);
  p.layouts[0].placements[1].bottom = 3000;
  assert.equal(layoutIssues(p).length, 0);
  p.layouts[0].placements[0].s = -100;
  assert.ok(layoutIssues(p).some((q) => q.message.includes('範囲外')));
});
test('歩行はL字空間の壁と柱に衝突する', () => {
  assert.equal(isWalkable(4000, 5000, b), true);
  assert.equal(isWalkable(-5000, 35000, b), true);
  assert.equal(isWalkable(-5000, 15000, b), false);
  assert.equal(isWalkable(9000, 20000, b), false);
  assert.equal(isWalkable(-425, b.length - 4970 - 425, b), false);
  assert.equal(isWalkable(100, 5000, b), false);
});
test('JSONラウンドトリップ・不正値・壊れた参照を検証する', () => {
  const p = createProject();
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  for (const mutation of [
    (d) => (d.schemaVersion = 999),
    (d) => (d.building.mainWidth = NaN),
    (d) => (d.building.length = 20000),
    (d) => (d.artworks[0].image = 'javascript:alert(1)'),
    (d) => (d.layouts[0].placements[0].artworkId = 'missing'),
    (d) => d.artworks.push({ ...d.artworks[0] }),
    (d) => (d.activeLayoutId = 'missing'),
  ]) {
    const d = structuredClone(p);
    mutation(d);
    assert.throws(() => validateProject(d));
  }
});
const partition = () => ({
  id: 'movable-1',
  name: '可動壁 01',
  railId: 'rail-cross-3',
  s: 4500,
  width: 3000,
  height: 5000,
  thickness: 200,
});
test('可動壁は指定された3 m × 5 m × 0.2 mで点線上に置かれる', () => {
  const rails = createRails(b),
    p = partition(),
    g = partitionGeometry(p, rails),
    r = rails.find((r) => r.id === p.railId);
  assert.equal(g.x, 4500);
  assert.equal(g.z, r.z1);
  assert.deepEqual(g.tangent, { x: 1, z: 0 });
  assert.equal(fitPartition({ ...p, s: -1000 }, b, rails).s, 1500);
  assert.equal(fitPartition({ ...p, s: 99999 }, b, rails).s, 7485);
  assert.throws(() => fitPartition({ ...p, height: 6000 }, b, rails), /天井高/);
});
test('可動壁の表裏面は厚みの半分ずつ離れ、作品が正しい側に付く', () => {
  const rails = createRails(b),
    p = partition(),
    g = partitionGeometry(p, rails),
    faces = partitionFaces(p, rails);
  assert.equal(faces.length, 2);
  assert.equal(faces[0].length, 3000);
  assert.equal(faces[0].height, 5000);
  assert.equal(faces[0].start.z, g.z - 100);
  assert.equal(faces[1].start.z, g.z + 100);
  const art = createProject().artworks[0],
    front = positionOnWall(faces[0], 1500, 950, art),
    back = positionOnWall(faces[1], 1500, 950, art);
  assert.equal(front.x, 4500);
  assert.ok(front.z < g.z - 100);
  assert.ok(back.z > g.z + 100);
  assert.equal(
    fitPlacement({ wallId: faces[0].id, s: 1500, bottom: 99999 }, art, b, [p], rails).bottom,
    3900,
  );
});
test('可動壁の移動・方向変更に対して作品の壁面座標が保持される', () => {
  const rails = createRails(b),
    p = partition(),
    art = createProject().artworks[0],
    local = { s: 1200, bottom: 700 };
  const original = positionOnWall(partitionFaces(p, rails)[0], local.s, local.bottom, art);
  const moved = positionOnWall(
    partitionFaces({ ...p, s: p.s + 1000 }, rails)[0],
    local.s,
    local.bottom,
    art,
  );
  assert.equal(moved.x - original.x, 1000);
  assert.equal(moved.y, original.y);
  assert.equal(moved.z, original.z);
  const rotated = partitionFaces({ ...p, railId: 'rail-centre', s: 5000 }, rails)[0];
  assert.deepEqual(rotated.tangent, { x: 0, z: 1 });
  assert.equal(rotated.length, 3000);
});
test('可動壁も歩行衝突・壁同士の干渉判定に含まれる', () => {
  const d = createProject(),
    p = partition();
  d.layouts[0].partitions = [p];
  const g = partitionGeometry(p, d.rails);
  assert.equal(isWalkable(g.x, g.z, b, [p], d.rails), false);
  assert.equal(isWalkable(g.x, g.z + 500, b, [p], d.rails), true);
  d.layouts[0].partitions.push({ ...p, id: 'other', name: '可動壁 02', s: p.s + 100 });
  assert.ok(layoutIssues(d).some((i) => i.type === 'partition' && i.message.includes('可動壁 02')));
});
test('可動壁・配置ラインを含むJSONと旧データの移行を検証する', () => {
  const d = createProject(),
    p = partition();
  d.layouts[0].partitions.push(p);
  d.layouts[0].placements.push({
    id: 'mounted',
    artworkId: 'art-1',
    wallId: `partition:${p.id}:back`,
    s: 1500,
    bottom: 950,
  });
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(d))), d);
  const legacy = createProject();
  delete legacy.rails;
  delete legacy.layouts[0].partitions;
  validateProject(legacy);
  assert.equal(legacy.rails.length, 13);
  assert.deepEqual(legacy.layouts[0].partitions, []);
  const invalid = structuredClone(d);
  invalid.rails[0].x2 = 5000;
  invalid.rails[0].z2 += 100;
  assert.throws(() => validateProject(invalid), /水平・垂直/);
  const lost = structuredClone(d);
  lost.rails = lost.rails.filter((r) => r.id !== p.railId);
  assert.throws(() => validateProject(lost), /配置ライン/);
});
