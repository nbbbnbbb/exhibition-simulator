import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, layoutIssues, walls } from '../src/domain.js';
import {
  newPlacement,
  previewPlacement,
  assertInventoryChange,
  pickWall,
  previewMove,
  movedPlacement,
  movedPlacements,
  pickPlanWall,
} from '../src/artworkPlacement.js';
import { inventoryProblem, quantityLimit } from '../src/catalog.js';
import { DEFAULT_LABELS, normalizeLabels, artworkLabelRows } from '../src/artworkLabels.js';
import { makeArtworkLabel } from '../src/artworkLabels3D.js';
const candidate = (s = 16000, bottom = 1000, wallId = 'west') => ({
  id: crypto.randomUUID(),
  s,
  bottom,
  wallId,
});

function groupProject() {
  const project = createProject();
  Object.assign(project.layouts[0].placements[0], { s: 5000, bottom: 900 });
  Object.assign(project.layouts[0].placements[1], { s: 6500, bottom: 1450 });
  project.layouts[0].placements[2].s = 18000;
  return project;
}
const groupIds = ['p-1', 'p-2'];

test('複数作品を共通の移動量で動かし、元の選択位置との衝突を除外する', () => {
  const project = groupProject(),
    before = structuredClone(project);
  const result = previewMove(project, 'p-1', { s: 6500, bottom: 1200 }, groupIds);
  assert.equal(result.valid, true);
  assert.deepEqual(
    result.placements.map((p) => [p.id, p.s, p.bottom]),
    [
      ['p-1', 6500, 1200],
      ['p-2', 8000, 1750],
    ],
  );
  assert.deepEqual(project, before, 'preview is never a partial document update');
  const next = structuredClone(project);
  const changes = new Map(
    movedPlacements(project, 'p-1', result.placement, groupIds).map((p) => [p.id, p]),
  );
  next.layouts[0].placements = next.layouts[0].placements.map((p) => changes.get(p.id) || p);
  assert.doesNotThrow(() => assertInventoryChange(project, next));
  assert.deepEqual(next.artworks, project.artworks, 'move does not consume quantities');
  assert.deepEqual(next.layouts[0].placements.slice(2), project.layouts[0].placements.slice(2));
});

test('別の壁へ移動しても正面からの左右順・間隔・高さの差を保つ', () => {
  const project = groupProject();
  const result = movedPlacements(
    project,
    'p-1',
    { wallId: 'east', s: 9000, bottom: 1800 },
    groupIds,
  );
  assert.deepEqual(
    result.map((p) => [p.wallId, p.s, p.bottom]),
    [
      ['east', 9000, 1800],
      ['east', 7500, 2350],
    ],
  );
  const next = structuredClone(project);
  next.layouts[0].placements.splice(0, 2, ...result);
  const back = movedPlacements(next, 'p-1', { wallId: 'west', s: 5000, bottom: 900 }, groupIds);
  assert.deepEqual(back, project.layouts[0].placements.slice(0, 2));
});

test('端・床・天井への制限もグループ全体への同じ平行移動にする', () => {
  const project = groupProject();
  for (const candidate of [
    { s: -10000, bottom: -10000 },
    { s: 100000, bottom: 100000 },
  ]) {
    const result = previewMove(project, 'p-1', candidate, groupIds);
    assert.equal(result.valid, true);
    const [a, b] = result.placements;
    assert.equal(b.s - a.s, 1500);
    assert.equal(b.bottom - a.bottom, 550);
    for (const p of result.placements) {
      const art = project.artworks.find((a) => a.id === p.artworkId);
      assert.ok(p.s - art.width / 2 >= 0 && p.s + art.width / 2 <= 27035);
      assert.ok(p.bottom >= 0 && p.bottom + art.height <= 5500);
    }
  }
});

test('つかんだ作品以外が他作品と重なってもグループ全体を拒否する', () => {
  const project = groupProject();
  Object.assign(project.layouts[0].placements[3], { s: 7500, bottom: 2350 });
  const before = structuredClone(project);
  const candidate = { wallId: 'east', s: 9000, bottom: 1800 };
  const result = previewMove(project, 'p-1', candidate, groupIds);
  assert.equal(result.valid, false);
  assert.match(result.message, /重なります/);
  assert.equal(result.placements.length, 2, 'all previews remain available for red feedback');
  assert.throws(() => movedPlacements(project, 'p-1', candidate, groupIds), /重なります/);
  assert.deepEqual(project, before);
});

test('壁端でまとめて収めた後にも未選択作品との衝突を判定する', () => {
  const project = groupProject();
  Object.assign(project.layouts[0].placements[2], { s: 1950, bottom: 550 });
  const result = previewMove(project, 'p-1', { s: -10000, bottom: -10000 }, groupIds);
  assert.equal(result.placement.s, 450);
  assert.equal(result.placements[1].s, 1950);
  assert.equal(result.valid, false);
});

test('グループが収まらない短い壁・低い可動壁とガラス面には確定できない', () => {
  const project = groupProject();
  project.layouts[0].partitions.push({
    id: 'low',
    name: '低い壁',
    railId: project.rails[0].id,
    s: 4000,
    width: 4000,
    height: 1200,
    thickness: 200,
  });
  for (const wallId of ['west-return', 'partition:low:front', 'north']) {
    const result = previewMove(project, 'p-1', { wallId, s: 1000, bottom: 0 }, groupIds);
    assert.equal(result.valid, false);
    assert.match(result.message, /収まりません|展示可能/);
  }
});

test('可動壁の表裏へ移す際も全員の左右関係と高さを保持する', () => {
  const project = groupProject();
  project.layouts[0].partitions.push({
    id: 'part',
    name: '壁',
    railId: project.rails[0].id,
    s: 4000,
    width: 4000,
    height: 3500,
    thickness: 200,
  });
  for (const face of ['front', 'back']) {
    const result = previewMove(
      project,
      'p-2',
      { wallId: `partition:part:${face}`, s: 2000, bottom: 1450 },
      groupIds,
    );
    assert.equal(result.valid, true);
    const [a, b] = result.placements;
    assert.equal(b.s - a.s, face === 'front' ? 1500 : -1500);
    assert.equal(b.bottom - a.bottom, 550);
    assert.ok(result.placements.every((p) => p.wallId.endsWith(`:${face}`)));
  }
});

test('上下の行列や奇数寸法でも1mm単位の相対座標を変えずに移動する', () => {
  const project = groupProject();
  Object.assign(project.artworks[0], { width: 901, height: 1101 });
  Object.assign(project.artworks[1], { width: 701, height: 901 });
  Object.assign(project.layouts[0].placements[1], { s: 5000, bottom: 2202 });
  const result = previewMove(project, 'p-2', { wallId: 'east', s: 1, bottom: 10000 }, groupIds);
  assert.equal(result.valid, true);
  const [a, b] = result.placements;
  assert.equal(a.s, b.s);
  assert.equal(b.bottom - a.bottom, 1302);
  assert.ok(result.placements.every((p) => Number.isInteger(p.s) && Number.isInteger(p.bottom)));
});

test('異なる壁からの選択や壊れた選択は理由を返して拒否し、重複IDは増殖しない', () => {
  const project = groupProject();
  for (const [ids, pattern] of [
    [['p-1', 'p-4'], /同じ壁面/],
    [['p-1', 'missing'], /見つかりません/],
    [['p-2'], /含めて/],
  ]) {
    const result = previewMove(project, 'p-1', { s: 1000 }, ids);
    assert.equal(result.valid, false);
    assert.match(result.message, pattern);
  }
  const result = previewMove(project, 'p-1', { s: 7000 }, ['p-1', 'p-2', 'p-2']);
  assert.equal(result.valid, true);
  assert.equal(result.placements.length, 2);
  assert.equal(previewMove(project, 'p-1', { s: NaN }, groupIds).valid, false);
});
test('旧作品の数量欠落は1、明示的な未定は追加不可として移行する', () => {
  const p = createProject();
  delete p.artworks[0].quantity;
  delete p.artworkLabels;
  assert.equal(quantityLimit(p.artworks[0]), 1);
  const loaded = validateProject(p);
  assert.equal(loaded.artworks[0].quantity, 1);
  assert.equal(loaded.artworkLabels.enabled, false);
  assert.match(inventoryProblem(p.artworks[0], p.layouts[0].placements), /上限/);
  p.artworks[0].quantity = null;
  assert.match(inventoryProblem(p.artworks[0], []), /入力/);
});
test('数量上限はプランごと。連続追加・可動壁複製による超過も拒否する', () => {
  const p = createProject();
  p.artworks[0].quantity = 2;
  const next = structuredClone(p),
    l = next.layouts[0];
  l.placements.push(newPlacement(next, 'art-1', candidate()));
  assert.doesNotThrow(() => assertInventoryChange(p, next));
  assert.throws(() => newPlacement(next, 'art-1', candidate(19000)), /上限/);
  const over = structuredClone(next);
  over.layouts[0].placements.push({ ...l.placements.at(-1), ...candidate(19000) });
  assert.throws(() => assertInventoryChange(next, over), /数量/);
  const alternate = structuredClone(next.layouts[0]);
  alternate.id = 'alternate';
  next.layouts.push(alternate);
  assert.doesNotThrow(() => assertInventoryChange(p, next));
});
test('追加位置が既存作品と重なる場合は拒否。上下に離す・端を接する配置は許可', () => {
  const p = createProject();
  p.artworks[0].quantity = 3;
  const overlap = previewPlacement(p, 'art-1', candidate(6000, 950));
  assert.equal(overlap.valid, false);
  assert.match(overlap.message, /重なり/);
  assert.throws(() => newPlacement(p, 'art-1', candidate(6000, 950)), /重なり/);
  assert.equal(previewPlacement(p, 'art-1', candidate(6000, 2050)).valid, true);
  assert.equal(previewPlacement(p, 'art-1', candidate(6900, 950)).valid, true);
  const next = structuredClone(p);
  next.layouts[0].placements.push({ ...candidate(6000, 950), artworkId: 'art-1' });
  assert.throws(() => assertInventoryChange(p, next), /重なり/);
});
test('壁端へクランプした後にも重なりを検証する', () => {
  const p = createProject();
  p.artworks[0].quantity = 3;
  const end = p.building.sideDoorAt - p.artworks[0].width / 2;
  p.layouts[0].placements[0].s = end;
  const r = previewPlacement(p, 'art-1', candidate(100000, 950));
  assert.equal(r.placement.s, end);
  assert.equal(r.valid, false);
});
test('配置中の数量を下回る変更を拒否。旧超過データは開き、修正・解除できる', () => {
  const old = createProject();
  old.layouts[0].placements.push({ ...candidate(), artworkId: 'art-1' });
  assert.doesNotThrow(() => validateProject(old));
  assert.ok(layoutIssues(old).some((i) => i.message.includes('数量')));
  const moved = structuredClone(old);
  moved.layouts[0].placements[0].s += 50;
  assert.doesNotThrow(() => assertInventoryChange(old, moved));
  moved.layouts[0].placements.pop();
  assert.doesNotThrow(() => assertInventoryChange(old, moved));
  const p = createProject();
  p.artworks[0].quantity = 2;
  p.layouts[0].placements.push({ ...candidate(), artworkId: 'art-1' });
  const reduced = structuredClone(p);
  reduced.artworks[0].quantity = 1;
  assert.throws(() => assertInventoryChange(p, reduced), /数量/);
  reduced.artworks[0].quantity = null;
  assert.throws(() => assertInventoryChange(p, reduced), /数量/);
});
test('ポインター光線は正しい壁・可動壁の表裏に当たり、床越しには選択しない', () => {
  const p = createProject();
  assert.equal(pickWall(p, { x: 4000, y: 1500, z: 6000 }, { x: -1, y: 0, z: 0 }).wall.id, 'west');
  assert.equal(pickWall(p, { x: 4000, y: 1500, z: 7000 }, { x: 1, y: 0, z: 0 }).wall.id, 'east');
  assert.equal(pickWall(p, { x: 4000, y: 1500, z: 6000 }, { x: 1, y: 0, z: 0 }), null);
  assert.equal(
    pickWall(p, { x: 4000, y: 1500, z: 6000 }, { x: 0, y: 0, z: -1 }).wall.hangable,
    false,
  );
  assert.equal(pickWall(p, { x: 4000, y: 1500, z: 6000 }, { x: -1, y: -1, z: 0 }), null);
  const rail = p.rails.find((r) => r.id === 'rail-cross-3');
  p.layouts[0].partitions.push({
    id: 'partition',
    name: '壁',
    railId: rail.id,
    s: 4000,
    width: 3000,
    height: 5000,
    thickness: 200,
  });
  for (const side of [-1, 1]) {
    const hit = pickWall(
      p,
      { x: 4000, y: 1500, z: rail.z1 + side * 1000 },
      { x: 0, y: 0, z: -side },
    );
    assert.ok(hit.wall.partitionId);
    assert.equal(hit.wall.normal.z, side);
  }
});
test('作品情報の選択項目だけを表示し、空欄を除き、JSONに保存する', () => {
  const p = createProject();
  p.artworkLabels = { enabled: true, fields: ['artist', 'year', 'dimensions', 'quantity'] };
  const rows = artworkLabelRows(p.artworks[0], p.artworkLabels);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['artist', 'dimensions', 'quantity'],
  );
  assert.equal(rows.at(-1).value, '1');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).artworkLabels, {
    ...DEFAULT_LABELS,
    ...p.artworkLabels,
  });
  assert.deepEqual(normalizeLabels({ enabled: true, fields: ['title', 'invalid', 'title'] }), {
    ...DEFAULT_LABELS,
    enabled: true,
    fields: ['title'],
  });
  p.artworkLabels.fields.push('invalid');
  assert.throws(() => validateProject(p), /表示設定/);
});

test('作品上部の文字サイズ・行間・横幅・余白を保存し、旧設定に初期値を補う', () => {
  const p = createProject();
  p.artworkLabels = {
    ...DEFAULT_LABELS,
    enabled: true,
    fields: ['title', 'artist'],
    fontSize: 28,
    lineHeight: 180,
    width: 1000,
    gap: 200,
  };
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).artworkLabels, p.artworkLabels);
  for (const [key, value] of [
    ['fontSize', 0],
    ['fontSize', 49],
    ['fontSize', '20'],
    ['lineHeight', 119],
    ['width', 2001],
    ['gap', -1],
  ]) {
    const invalid = structuredClone(p);
    invalid.artworkLabels[key] = value;
    assert.throws(() => validateProject(invalid), /表示設定/);
  }
  delete p.artworkLabels;
  assert.deepEqual(validateProject(p).artworkLabels, DEFAULT_LABELS);
});

test('ラベルは壁端・天井際・可動壁の表裏でも作品の真上に置き、文字を拡大しても下端の余白を保つ', (t) => {
  const context = {
    font: '',
    measureText(text) {
      return { width: [...text].length * (parseFloat(this.font.replace('600 ', '')) || 35) };
    },
    fillRect() {},
    strokeRect() {},
    fillText() {},
    scale() {},
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ getContext: () => context }) },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
  const project = createProject(),
    art = project.artworks[0];
  const wall = walls(project.building).find((w) => w.id === 'west');
  const first = makeArtworkLabel(art, { s: 0, bottom: wall.height - art.height }, wall, {
    ...DEFAULT_LABELS,
    fields: ['title', 'artist'],
  });
  const larger = makeArtworkLabel(art, { s: 0, bottom: wall.height - art.height }, wall, {
    ...DEFAULT_LABELS,
    fields: ['title', 'artist'],
    fontSize: 32,
    gap: 200,
  });
  assert.equal(first.position.x, 0);
  assert.ok(
    Math.abs(first.position.y - first.geometry.parameters.height / 2 - art.height / 2000 - 0.09) <
      1e-9,
  );
  assert.ok(larger.geometry.parameters.height > first.geometry.parameters.height);
  assert.ok(
    Math.abs(larger.position.y - larger.geometry.parameters.height / 2 - art.height / 2000 - 0.2) <
      1e-9,
  );
  for (const normal of [
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ]) {
    const card = makeArtworkLabel(
      art,
      { s: wall.length, bottom: 0 },
      { ...wall, normal },
      { ...DEFAULT_LABELS, width: 1000 },
    );
    assert.equal(card.position.x, 0);
    assert.equal(card.geometry.parameters.width, 1);
    assert.ok(card.position.y > art.height / 2000);
    card.geometry.dispose();
    card.material.map.dispose();
    card.material.dispose();
  }
  const overlay = makeArtworkLabel(art, { s: 0, bottom: 1000 }, wall, {
    ...DEFAULT_LABELS,
    position: 'overlay',
    fontSize: 24,
    gap: 1000,
  });
  assert.equal(overlay.position.x, 0);
  assert.equal(overlay.position.y, 0);
  assert.ok(overlay.position.z > art.depth / 2000);
  assert.equal(overlay.material.transparent, true);
  assert.ok(overlay.material.opacity < 1);
  overlay.geometry.dispose();
  overlay.material.map.dispose();
  overlay.material.dispose();
  for (const card of [first, larger]) {
    card.geometry.dispose();
    card.material.map.dispose();
    card.material.dispose();
  }
});

test('作品に重ねる表示位置もJSONに保存し、旧ラベルは作品の上を初期値にする', () => {
  const p = createProject();
  p.artworkLabels.position = 'overlay';
  assert.equal(validateProject(JSON.parse(JSON.stringify(p))).artworkLabels.position, 'overlay');
  delete p.artworkLabels.position;
  assert.equal(validateProject(p).artworkLabels.position, 'above');
  p.artworkLabels.position = 'invalid';
  assert.throws(() => validateProject(p), /表示設定/);
  assert.equal(normalizeLabels({ position: 'overlay' }).position, 'overlay');
});
test('数量上限1の配置済み作品を別の壁面へ移動してもID・数量・保存前の状態を保つ', () => {
  const p = createProject(),
    original = structuredClone(p);
  const moved = movedPlacement(p, 'p-1', {
    wallId: 'east',
    s: 1000,
    bottom: 1200,
    id: 'forged',
    artworkId: 'art-2',
  });
  assert.equal(moved.id, 'p-1');
  assert.equal(moved.artworkId, 'art-1');
  assert.equal(moved.wallId, 'east');
  assert.equal(moved.bottom, 1200);
  assert.deepEqual(p, original);
  const next = structuredClone(p);
  next.layouts[0].placements[0] = moved;
  assert.doesNotThrow(() => assertInventoryChange(p, next));
  assert.equal(next.layouts[0].placements.length, 4);
});
test('自分自身との接触は除外し、別の壁の作品との重なり・ガラスへの移動は拒否する', () => {
  const p = createProject();
  assert.equal(previewMove(p, 'p-1', { s: 6000 }).valid, true);
  assert.equal(previewMove(p, 'p-1', { wallId: 'east', s: 12000, bottom: 1100 }).valid, false);
  assert.throws(() => movedPlacement(p, 'p-1', { wallId: 'north', s: 4000 }), /壁面/);
  const next = structuredClone(p);
  Object.assign(next.layouts[0].placements[0], { wallId: 'east', s: 12000, bottom: 1100 });
  assert.throws(() => assertInventoryChange(p, next), /重なり/);
});
test('可動壁の表裏へ移動でき、壁端・高さに収めてから重なりを判定する', () => {
  const p = createProject(),
    rail = p.rails.find((r) => r.id === 'rail-cross-3');
  p.layouts[0].partitions.push({
    id: 'part',
    name: '可動壁',
    railId: rail.id,
    s: 4000,
    width: 3000,
    height: 5000,
    thickness: 200,
  });
  for (const face of ['front', 'back']) {
    const moved = movedPlacement(p, 'p-1', {
      wallId: `partition:part:${face}`,
      s: -1000,
      bottom: 10000,
    });
    assert.equal(moved.s, 450);
    assert.equal(moved.bottom, 3900);
  }
  assert.equal(pickPlanWall(p, { x: 4000, z: rail.z1 - 120 }, 500).wall.id, 'partition:part:front');
  assert.equal(pickPlanWall(p, { x: 4000, z: rail.z1 + 120 }, 500).wall.id, 'partition:part:back');
});
