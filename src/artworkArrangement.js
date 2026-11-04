import { walls, clamp, mm } from './domain.js';
import { overlapProblem } from './artworkPlacement.js';

const alignments = {
  left: ['x', 0],
  'horizontal-center': ['x', 0.5],
  right: ['x', 1],
  top: ['y', 0],
  'vertical-center': ['y', 0.5],
  bottom: ['y', 1],
};

function nonnegative(value) {
  if (!Number.isInteger(value) || value < 0)
    throw new Error('すき間は0以上の整数で指定してください');
  return value;
}

// Work in an elevation seen from in front of the wall: x grows right, y grows down.
// The wall's tangent can point either way, including on the two partition faces.
export function arrangeArtworks(project, ids, options) {
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId);
  const selected = [...new Set(ids)].map((id) => layout.placements.find((p) => p.id === id));
  if (selected.some((p) => !p)) throw new Error('選択した作品の配置が見つかりません');
  if (selected.length < 2) throw new Error('同じ壁の作品を2点以上選択してください');
  if (new Set(selected.map((p) => p.wallId)).size !== 1)
    throw new Error('整列・均等配置は同じ壁面の作品を選択してください');
  const wall = walls(project.building, layout.partitions, project.rails).find(
    (w) => w.id === selected[0].wallId && w.hangable,
  );
  if (!wall) throw new Error('展示可能な壁面を選んでください');
  const direction = Math.sign(wall.tangent.x * wall.normal.z - wall.tangent.z * wall.normal.x);
  const records = selected.map((p) => {
    const art = project.artworks.find((a) => a.id === p.artworkId);
    if (!art || !(art.width > 0) || !(art.height > 0))
      throw new Error('作品の実寸を確認してください');
    return { p, art, x: direction * p.s, y: -p.bottom - art.height / 2 };
  });
  const size = (r, axis) => (axis === 'x' ? r.art.width : r.art.height);
  const bounds = (axis) => ({
    start: Math.min(...records.map((r) => r[axis] - size(r, axis) / 2)),
    end: Math.max(...records.map((r) => r[axis] + size(r, axis) / 2)),
  });

  if (options.mode === 'align') {
    const alignment = alignments[options.alignment];
    if (!alignment) throw new Error('整列の種類を選んでください');
    const [axis, fraction] = alignment;
    const { start, end } = bounds(axis);
    const target = start + (end - start) * fraction;
    for (const r of records) r[axis] = target + (0.5 - fraction) * size(r, axis);
  } else if (options.mode === 'distribute') {
    if (!['horizontal', 'vertical'].includes(options.axis))
      throw new Error('横方向または縦方向を選んでください');
    const axis = options.axis === 'vertical' ? 'y' : 'x';
    const sorted = [...records].sort((a, b) => a[axis] - b[axis]);
    const start = sorted[0][axis] - size(sorted[0], axis) / 2;
    const end = sorted.at(-1)[axis] + size(sorted.at(-1), axis) / 2;
    const gap =
      options.gap == null
        ? (end - start - sorted.reduce((sum, r) => sum + size(r, axis), 0)) / (sorted.length - 1)
        : nonnegative(options.gap);
    if (gap < 0) throw new Error('作品が重なります。両端の距離を広げてください');
    let cursor = start;
    for (const r of sorted) {
      r[axis] = cursor + size(r, axis) / 2;
      // A horizontal centre is an integer mm; round away from the previous
      // work for fixed gaps so odd frame widths also permit a zero gap.
      if (axis === 'x' && options.gap != null) r.x = Math.ceil(r.x);
      cursor = r[axis] + size(r, axis) / 2 + gap;
    }
  } else if (options.mode === 'grid') {
    const { columns } = options;
    if (!Number.isInteger(columns) || columns < 1 || columns > records.length)
      throw new Error('列数は1から対象作品数までの整数で指定してください');
    const gapX = nonnegative(options.gapX),
      gapY = nonnegative(options.gapY);
    const rows = Math.ceil(records.length / columns);
    const widths = Array(columns).fill(0),
      heights = Array(rows).fill(0);
    records.forEach((r, i) => {
      widths[i % columns] = Math.max(widths[i % columns], r.art.width);
      heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)], r.art.height);
    });
    // Integer column centres give the tightest safe spacing for odd widths.
    const offsets = [Math.ceil(widths[0] / 2)];
    for (let i = 1; i < columns; i++)
      offsets.push(offsets[i - 1] + Math.ceil((widths[i - 1] + widths[i]) / 2 + gapX));
    const width = Math.ceil(offsets.at(-1) + widths.at(-1) / 2),
      height = heights.reduce((a, b) => a + b, 0) + gapY * (rows - 1);
    if (width > wall.length || height > wall.height)
      throw new Error('指定の列数・すき間では行列が壁面に収まりません');
    const bx = bounds('x'),
      by = bounds('y');
    // Keep the selection's centre, translating the entire grid only to fit the wall.
    const x = clamp(
      mm((bx.start + bx.end - width) / 2),
      direction < 0 ? -wall.length : 0,
      (direction < 0 ? 0 : wall.length) - width,
    );
    let y = clamp((by.start + by.end - height) / 2, -wall.height, -height);
    const xs = offsets.map((offset) => x + offset);
    const ys = heights.map((h) => {
      const centre = y + h / 2;
      y += h + gapY;
      return centre;
    });
    records.forEach((r, i) => {
      r.x = xs[i % columns];
      r.y = ys[Math.floor(i / columns)];
    });
  } else {
    throw new Error('配置方法を選んでください');
  }

  const changes = new Map(
    records.map((r) => [
      r.p.id,
      {
        ...r.p,
        s: mm(direction * r.x),
        bottom: mm(-r.y - r.art.height / 2),
      },
    ]),
  );
  const placements = layout.placements.map((p) => changes.get(p.id) || p);
  const nextLayout = { ...layout, placements };
  // Validate the complete result before returning: no clamping individual works,
  // partial edits or collisions with works outside the selection.
  for (const { p, art } of records) {
    const q = changes.get(p.id);
    if (
      q.s - art.width / 2 < 0 ||
      q.s + art.width / 2 > wall.length ||
      q.bottom < 0 ||
      q.bottom + art.height > wall.height
    )
      throw new Error('指定の配置では壁面に収まりません。位置・すき間・列数を調整してください');
    const problem = overlapProblem(project, q, nextLayout);
    if (problem) throw new Error(problem);
  }
  return placements;
}
