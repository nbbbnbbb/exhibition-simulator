import { walls, fitPlacement, inFloor, clamp, mm } from './domain.js';
import { inventoryProblem, quantityLimit, placedCount, placementProblem } from './catalog.js';

const active = (project) => project.layouts.find((l) => l.id === project.activeLayoutId);
export function overlapProblem(project, placement, layout = active(project)) {
  const art = project.artworks.find((a) => a.id === placement.artworkId);
  for (const other of layout.placements) {
    if (other.id === placement.id || other.wallId !== placement.wallId) continue;
    const a = project.artworks.find((a) => a.id === other.artworkId);
    if (
      a &&
      Math.abs(placement.s - other.s) < (art.width + a.width) / 2 &&
      placement.bottom < other.bottom + a.height &&
      other.bottom < placement.bottom + art.height
    )
      return `「${a.title}」と重なります。空いている位置を選んでください`;
  }
  return '';
}
export function previewPlacement(project, artworkId, candidate) {
  const art = project.artworks.find((a) => a.id === artworkId);
  try {
    if (!art) throw new Error('作品が見つかりません');
    const layout = active(project);
    const placement = fitPlacement(
      { ...candidate, artworkId },
      art,
      project.building,
      layout.partitions,
      project.rails,
    );
    const message = inventoryProblem(art, layout.placements) || overlapProblem(project, placement);
    return { placement, valid: !message, message };
  } catch (err) {
    return { placement: null, valid: false, message: err.message };
  }
}
export function newPlacement(project, artworkId, candidate) {
  const result = previewPlacement(project, artworkId, candidate);
  if (!result.valid) throw new Error(result.message);
  return result.placement;
}
export function artworkBatchDimensions(art, options) {
  const count = options?.count ?? 1,
    columns = options?.columns ?? 1,
    gapX = options?.gapX ?? 0,
    gapY = options?.gapY ?? 0;
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw new Error('追加する点数は1〜10,000の整数で指定してください');
  if (!Number.isInteger(columns) || columns < 1 || columns > count)
    throw new Error('列数は1から追加する点数までの整数で指定してください');
  if (![gapX, gapY].every((v) => Number.isInteger(v) && v >= 0 && v <= 100000))
    throw new Error('間隔は0〜100,000 mmの整数で指定してください');
  const rows = Math.ceil(count / columns);
  return {
    count,
    columns,
    rows,
    gapX,
    gapY,
    width: art.width * columns + gapX * (columns - 1),
    height: art.height * rows + gapY * (rows - 1),
  };
}
export function previewArtworkAddition(project, artworkId, candidate, options) {
  if (!options) return previewPlacement(project, artworkId, candidate);
  let placements = [];
  try {
    const art = project.artworks.find((a) => a.id === artworkId);
    if (!art) throw new Error('作品が見つかりません');
    const problem = placementProblem(art);
    if (problem) throw new Error(problem);
    const layout = active(project),
      size = artworkBatchDimensions(art, options),
      limit = quantityLimit(art);
    if (limit === null || placedCount(art, layout.placements) + size.count > limit)
      throw new Error('追加する点数が残りの数量を超えています');
    const wall = walls(project.building, layout.partitions, project.rails).find(
      (w) => w.id === candidate.wallId && w.hangable,
    );
    if (!wall) throw new Error('展示可能な壁面を選んでください');
    if (!Number.isFinite(candidate.s) || !Number.isFinite(candidate.bottom))
      throw new Error('追加先の座標が不正です');
    const direction = Math.sign(wall.tangent.x * wall.normal.z - wall.tangent.z * wall.normal.x);
    const span = (size.columns - 1) * (art.width + size.gapX),
      minS = Math.ceil(art.width / 2),
      maxS = Math.floor(wall.length - art.width / 2 - span);
    const fits = minS <= maxS && size.height <= wall.height;
    const startS = fits
      ? clamp(Math.round(candidate.s - span / 2), minS, maxS)
      : Math.round(candidate.s - span / 2);
    const bottom = fits
      ? clamp(mm(candidate.bottom), 0, wall.height - size.height)
      : mm(candidate.bottom);
    placements = Array.from({ length: size.count }, (_, index) => ({
      id: `preview-${index}`,
      artworkId,
      wallId: wall.id,
      s:
        startS +
        (direction < 0 ? size.columns - 1 - (index % size.columns) : index % size.columns) *
          (art.width + size.gapX),
      bottom:
        bottom + (size.rows - 1 - Math.floor(index / size.columns)) * (art.height + size.gapY),
    }));
    const message = !fits
      ? '行列全体が壁面に収まりません。点数・列数・間隔を変更してください'
      : placements.map((p) => overlapProblem(project, p)).find(Boolean) || '';
    return {
      placement: placements[0],
      placements,
      anchor: { wallId: wall.id, s: startS + span / 2, bottom },
      valid: !message,
      message,
    };
  } catch (error) {
    return { placement: null, placements, valid: false, message: error.message };
  }
}
export function newArtworkBatch(project, artworkId, candidate, options, ids) {
  const result = previewArtworkAddition(project, artworkId, candidate, options);
  if (!result.valid) throw new Error(result.message);
  const placements = result.placements || [result.placement];
  if (ids.length !== placements.length || new Set(ids).size !== ids.length)
    throw new Error('追加する作品の配置IDが不正です');
  return placements.map((p, index) => ({ ...p, id: ids[index] }));
}
export function previewMove(project, placementId, candidate, placementIds = [placementId]) {
  const layout = active(project),
    original = layout.placements.find((p) => p.id === placementId);
  try {
    if (!original) throw new Error('移動する作品が見つかりません');
    const ids = [...new Set(placementIds)];
    if (!ids.includes(placementId)) throw new Error('つかんだ作品を移動対象に含めてください');
    const originals = ids.map((id) => layout.placements.find((p) => p.id === id));
    if (originals.some((p) => !p)) throw new Error('移動する作品が見つかりません');
    if (originals.some((p) => p.wallId !== original.wallId))
      throw new Error('まとめて移動する作品は同じ壁面から選択してください');
    const ws = walls(project.building, layout.partitions, project.rails);
    const target = ws.find((w) => w.id === (candidate.wallId ?? original.wallId) && w.hangable);
    if (!target) throw new Error('展示可能な壁面を選んでください');
    const source = ws.find((w) => w.id === original.wallId);
    if (ids.length > 1 && !source) throw new Error('移動元の壁面が見つかりません');
    const facing = (w) => w.tangent.x * w.normal.z - w.tangent.z * w.normal.x;
    const direction = source ? Math.sign(facing(source) * facing(target)) : 1;
    const entries = originals.map((p) => {
      const art = project.artworks.find((a) => a.id === p.artworkId);
      const problem = placementProblem(art);
      if (problem) throw new Error(problem);
      return { p, art, ds: (p.s - original.s) * direction, db: p.bottom - original.bottom };
    });
    // Clamp one common translation, never individual works. Integer limits also
    // account for odd frame widths and keep every relative offset unchanged.
    const minS = Math.ceil(Math.max(...entries.map(({ art, ds }) => art.width / 2 - ds)));
    const maxS = Math.floor(
      Math.min(...entries.map(({ art, ds }) => target.length - art.width / 2 - ds)),
    );
    const minBottom = Math.max(...entries.map(({ db }) => -db));
    const maxBottom = Math.min(...entries.map(({ art, db }) => target.height - art.height - db));
    if (minS > maxS || minBottom > maxBottom)
      throw new Error('作品全体が壁面に収まりません。より広い壁面を選んでください');
    const s = mm(candidate.s ?? original.s),
      bottom = mm(candidate.bottom ?? original.bottom);
    if (!Number.isFinite(s) || !Number.isFinite(bottom)) throw new Error('移動先の座標が不正です');
    const anchorS = clamp(s, minS, maxS),
      anchorBottom = clamp(bottom, minBottom, maxBottom);
    const placements = entries.map(({ p, ds, db }) => ({
      ...p,
      wallId: target.id,
      s: anchorS + ds,
      bottom: anchorBottom + db,
    }));
    const changed = new Map(placements.map((p) => [p.id, p]));
    const nextLayout = {
      ...layout,
      placements: layout.placements.map((p) => changed.get(p.id) || p),
    };
    const message =
      placements.map((p) => overlapProblem(project, p, nextLayout)).find(Boolean) || '';
    return { placement: changed.get(placementId), placements, valid: !message, message };
  } catch (err) {
    return { placement: null, placements: [], valid: false, message: err.message };
  }
}
export function movedPlacements(project, placementId, candidate, placementIds = [placementId]) {
  const result = previewMove(project, placementId, candidate, placementIds);
  if (!result.valid) throw new Error(result.message);
  return result.placements;
}
export function movedPlacement(project, placementId, candidate) {
  const result = previewMove(project, placementId, candidate);
  if (!result.valid) throw new Error(result.message);
  return result.placement;
}
export function pickPlanWall(project, point, tolerance) {
  let nearest = null;
  const layout = active(project);
  for (const wall of walls(project.building, layout.partitions, project.rails)) {
    const s = Math.max(
      0,
      Math.min(
        wall.length,
        (point.x - wall.start.x) * wall.tangent.x + (point.z - wall.start.z) * wall.tangent.z,
      ),
    );
    const dx = point.x - wall.start.x - wall.tangent.x * s,
      dz = point.z - wall.start.z - wall.tangent.z * s;
    if (dx * wall.normal.x + dz * wall.normal.z < -1) continue;
    const distance = Math.hypot(dx, dz);
    if (distance <= tolerance && (!nearest || distance < nearest.distance))
      nearest = { wall, s, distance };
  }
  return nearest;
}
// Enforce every addition path (including wall duplication), while allowing old
// over-limit plans to open, move, or remove their existing works without data loss.
export function assertInventoryChange(before, next) {
  for (const layout of next.layouts) {
    const previous = before.layouts.find((l) => l.id === layout.id);
    for (const art of next.artworks) {
      const count = placedCount(art, layout.placements),
        limit = quantityLimit(art);
      const oldArt = before.artworks.find((a) => a.id === art.id);
      const oldCount = previous ? placedCount(art, previous.placements) : 0;
      const limitReduced =
        oldArt &&
        ((limit === null && quantityLimit(oldArt) !== null) ||
          (limit !== null && (quantityLimit(oldArt) === null || limit < quantityLimit(oldArt))));
      if ((limit === null ? count > 0 : count > limit) && (count > oldCount || limitReduced))
        throw new Error(
          `${art.title}：${layout.name}に${count}点配置中です。数量${limit ?? '未定'}を超える追加・数量の減少はできません`,
        );
    }
    if (previous)
      for (const placement of layout.placements) {
        const old = previous.placements.find((p) => p.id === placement.id);
        if (
          old &&
          old.wallId === placement.wallId &&
          old.s === placement.s &&
          old.bottom === placement.bottom
        )
          continue;
        const problem = overlapProblem(next, placement, layout);
        if (problem) throw new Error(problem);
      }
  }
}
// Coordinates are millimetres. Surface normals face into the usable room.
export function pickWall(project, origin, direction) {
  const layout = active(project),
    b = project.building;
  let nearest = null;
  for (const wall of walls(b, layout.partitions, project.rails)) {
    const dot = direction.x * wall.normal.x + direction.z * wall.normal.z;
    if (dot >= -1e-8) continue;
    const distance =
      ((wall.start.x - origin.x) * wall.normal.x + (wall.start.z - origin.z) * wall.normal.z) / dot;
    if (distance < 0 || (nearest && distance >= nearest.distance)) continue;
    const point = {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    };
    const s = (point.x - wall.start.x) * wall.tangent.x + (point.z - wall.start.z) * wall.tangent.z;
    if (s < 0 || s > wall.length || point.y < 0 || point.y > wall.height) continue;
    // Do not select a wall through the floor or the estimated solid column.
    if (direction.y < 0) {
      const t = -origin.y / direction.y;
      if (
        t > 0 &&
        t < distance &&
        inFloor(origin.x + direction.x * t, origin.z + direction.z * t, b)
      )
        continue;
    }
    nearest = { wall, point, s, distance };
  }
  if (!nearest) return null;
  // The interior column is opaque, even though it is not a hanging surface.
  const min = { x: -b.columnSize, y: 0, z: b.length - 4970 - b.columnSize },
    max = { x: 0, y: b.height, z: b.length - 4970 };
  let near = 0,
    far = nearest.distance;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) {
        near = Infinity;
        break;
      }
    } else {
      const a = (min[axis] - origin[axis]) / direction[axis],
        z = (max[axis] - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, z));
      far = Math.min(far, Math.max(a, z));
    }
  }
  return near <= far ? null : nearest;
}
