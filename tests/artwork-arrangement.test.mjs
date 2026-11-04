import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, walls, layoutIssues } from '../src/domain.js';
import { arrangeArtworks } from '../src/artworkArrangement.js';

function fixture(wallId = 'east') {
  const project = createProject();
  [
    [1000, 500],
    [600, 800],
    [800, 400],
    [500, 600],
  ].forEach(([width, height], i) => {
    Object.assign(project.artworks[i], { width, height });
  });
  project.layouts[0].placements = project.artworks.slice(0, 4).map((art, i) => ({
    id: `p-${i + 1}`,
    artworkId: art.id,
    wallId,
    s: 2000 + i * 4000,
    bottom: [700, 1000, 1500, 2200][i],
  }));
  return project;
}
const ids = ['p-1', 'p-2', 'p-3'];
const placements = (p) => p.layouts[0].placements;
const centreY = (p, project) =>
  p.bottom + project.artworks.find((a) => a.id === p.artworkId).height / 2;
const apply = (project, options, selected = ids) => arrangeArtworks(project, selected, options);

test('上端・上下中央・下端を選択範囲に揃え、横位置・未選択作品を保持する', () => {
  for (const [alignment, expected] of [
    ['top', 1900],
    ['vertical-center', 1300],
    ['bottom', 700],
  ]) {
    const project = fixture();
    const before = structuredClone(project);
    const result = apply(project, { mode: 'align', alignment });
    for (const p of result.slice(0, 3)) {
      const art = project.artworks.find((a) => a.id === p.artworkId);
      const value =
        alignment === 'top'
          ? p.bottom + art.height
          : alignment === 'bottom'
            ? p.bottom
            : centreY(p, project);
      assert.equal(value, expected);
      assert.equal(p.s, placements(project).find((q) => q.id === p.id).s);
    }
    assert.deepEqual(result[3], placements(project)[3]);
    assert.deepEqual(project, before, 'calculations must not mutate the project');
  }
});

test('左端・左右中央・右端は壁の正面向きに合わせ、異寸法の額縁の端を揃える', () => {
  for (const wallId of ['east', 'west', 'wing-north', 'wing-south']) {
    for (const alignment of ['left', 'horizontal-center', 'right']) {
      const project = fixture(wallId);
      placements(project).forEach((p, i) => {
        p.s = 1500 + 2000 * i;
        p.bottom = [100, 1500, 3100, 4200][i];
      });
      const wall = walls(project.building).find((w) => w.id === wallId);
      const direction = Math.sign(wall.tangent.x * wall.normal.z - wall.tangent.z * wall.normal.x);
      const start = Math.min(
        ...placements(project)
          .slice(0, 3)
          .map((p, i) => direction * p.s - project.artworks[i].width / 2),
      );
      const end = Math.max(
        ...placements(project)
          .slice(0, 3)
          .map((p, i) => direction * p.s + project.artworks[i].width / 2),
      );
      const target = alignment === 'left' ? start : alignment === 'right' ? end : (start + end) / 2;
      const result = apply(project, { mode: 'align', alignment });
      result.slice(0, 3).forEach((p, i) => {
        const half = project.artworks[i].width / 2;
        assert.equal(
          direction * p.s + (alignment === 'left' ? -half : alignment === 'right' ? half : 0),
          target,
        );
        assert.equal(p.bottom, placements(project)[i].bottom);
      });
    }
  }
});

test('横の均等配置は両端を固定して作品幅を考慮し、未選択作品を動かさない', () => {
  const project = fixture();
  const result = apply(project, { mode: 'distribute', axis: 'horizontal' });
  assert.deepEqual(
    result.slice(0, 3).map((p) => p.s),
    [2000, 6050, 10000],
  );
  assert.deepEqual(
    result.map((p) => p.bottom),
    placements(project).map((p) => p.bottom),
  );
  assert.deepEqual(result[3], placements(project)[3]);
});

test('縦の均等配置は上下端を固定し、高さの異なる作品のすき間を均等にする', () => {
  const project = fixture();
  placements(project)
    .slice(0, 3)
    .forEach((p, i) => {
      p.s = 5000;
      p.bottom = [100, 1500, 3500][i];
    });
  const result = apply(project, { mode: 'distribute', axis: 'vertical' });
  assert.deepEqual(
    result.slice(0, 3).map((p) => p.bottom),
    [100, 1650, 3500],
  );
  assert.deepEqual(
    result.map((p) => p.s),
    placements(project).map((p) => p.s),
  );
  const fixed = apply(project, { mode: 'distribute', axis: 'vertical', gap: 200 });
  assert.deepEqual(
    fixed.slice(0, 3).map((p) => p.bottom),
    [1800, 2500, 3500],
  );
});

test('指定した横のすき間は壁の正面から見た左端を固定する', () => {
  for (const [wallId, expected] of [
    ['east', [2000, 3000, 3900]],
    ['west', [8100, 9100, 10000]],
  ]) {
    const project = fixture(wallId);
    const result = apply(project, { mode: 'distribute', axis: 'horizontal', gap: 200 });
    assert.deepEqual(
      result.slice(0, 3).map((p) => p.s),
      expected,
    );
  }
});

test('行列は選択順に左上から並べ、各列・各行の最大寸法とすき間を使う', () => {
  const project = fixture();
  const result = apply(project, { mode: 'grid', columns: 2, gapX: 300, gapY: 200 }, [
    'p-3',
    'p-1',
    'p-2',
    'p-4',
  ]);
  const [a, b, c, d] = ['p-3', 'p-1', 'p-2', 'p-4'].map((id) => result.find((p) => p.id === id));
  assert.equal(a.s, c.s);
  assert.equal(b.s, d.s);
  assert.equal(b.s - a.s, 400 + 300 + 500);
  assert.equal(centreY(a, project), centreY(b, project));
  assert.equal(centreY(c, project), centreY(d, project));
  assert.equal(centreY(a, project) - centreY(c, project), 250 + 200 + 400);
  project.layouts[0].placements = result;
  assert.deepEqual(layoutIssues(project), []);
});

test('1列・端数行・壁際の行列も全体を壁内に収める', () => {
  for (const columns of [1, 2, 3]) {
    const project = fixture('west');
    placements(project)
      .slice(0, 3)
      .forEach((p) => {
        p.s = 600;
        p.bottom = 0;
      });
    const result = apply(project, { mode: 'grid', columns, gapX: 0, gapY: 100 });
    assert.equal(result.length, 4);
    assert.ok(
      result[0].s >= result[1].s || columns === 1,
      'grid reads from the front of the west wall',
    );
    project.layouts[0].placements = result;
    assert.deepEqual(layoutIssues(project), []);
  }
});

test('可動壁の表・裏で同じ正面方向の行列配置ができる', () => {
  for (const face of ['front', 'back']) {
    const project = fixture(`partition:test:${face}`);
    project.layouts[0].partitions.push({
      id: 'test',
      name: '可動壁',
      railId: project.rails[0].id,
      s: 5000,
      width: 3000,
      height: 4500,
      thickness: 200,
    });
    const result = apply(project, { mode: 'grid', columns: 2, gapX: 200, gapY: 150 });
    assert.equal(Math.sign(result[1].s - result[0].s), face === 'front' ? -1 : 1);
    for (const p of result.slice(0, 3)) assert.ok(p.s >= 0 && p.s <= 3000);
  }
});

test('1mmの奇数寸法とすき間0でも行列が重ならない', () => {
  const project = fixture();
  project.artworks.slice(0, 3).forEach((a, i) => {
    a.width = 101 + i;
    a.height = 103 - i;
  });
  for (const columns of [1, 2, 3]) {
    const result = apply(project, { mode: 'grid', columns, gapX: 0, gapY: 0 });
    const next = structuredClone(project);
    next.layouts[0].placements = result;
    assert.deepEqual(layoutIssues(next), []);
    assert.ok(result.every((p) => Number.isInteger(p.s) && Number.isInteger(p.bottom)));
  }
  const result = apply(project, { mode: 'distribute', axis: 'horizontal', gap: 0 });
  project.layouts[0].placements = result;
  assert.deepEqual(layoutIssues(project), []);
});

test('複数壁面・1点選択・不正な列数やすき間を拒否する', () => {
  const project = fixture();
  assert.throws(() => apply(project, { mode: 'align', alignment: 'top' }, ['p-1']), /2点以上/);
  assert.throws(
    () => apply(project, { mode: 'align', alignment: 'top' }, ['missing', 'p-1']),
    /見つかりません/,
  );
  placements(project)[1].wallId = 'west';
  assert.throws(() => apply(project, { mode: 'align', alignment: 'top' }), /同じ壁面/);
  placements(project)[1].wallId = 'east';
  for (const columns of [0, 1.5, 4, NaN])
    assert.throws(() => apply(project, { mode: 'grid', columns, gapX: 0, gapY: 0 }), /列数/);
  for (const gap of [-1, 1.5, NaN, Infinity])
    assert.throws(() => apply(project, { mode: 'distribute', axis: 'vertical', gap }), /すき間/);
});

test('壁幅・天井・床からはみ出す配置を一括拒否する', () => {
  const project = fixture();
  const before = structuredClone(project);
  assert.throws(
    () => apply(project, { mode: 'distribute', axis: 'horizontal', gap: 30000 }),
    /収まりません/,
  );
  assert.throws(
    () => apply(project, { mode: 'distribute', axis: 'vertical', gap: 5000 }),
    /収まりません/,
  );
  assert.throws(
    () => apply(project, { mode: 'grid', columns: 1, gapX: 0, gapY: 5000 }),
    /収まりません/,
  );
  assert.deepEqual(project, before);
});

test('選択内の衝突と未選択作品への衝突を、途中の変更を残さず拒否する', () => {
  const project = fixture();
  const before = structuredClone(project);
  assert.throws(
    () => apply(project, { mode: 'align', alignment: 'horizontal-center' }),
    /重なります/,
  );
  placements(project)[3].s = 3000;
  placements(project)[3].bottom = 700;
  const original = structuredClone(project);
  assert.throws(
    () => apply(project, { mode: 'distribute', axis: 'horizontal', gap: 200 }),
    /重なります/,
  );
  assert.deepEqual(project, original);
  placements(project)[3] = before.layouts[0].placements[3];
  placements(project)
    .slice(0, 3)
    .forEach((p) => {
      p.s = 5000;
    });
  assert.throws(() => apply(project, { mode: 'distribute', axis: 'vertical' }), /両端の距離/);
});
