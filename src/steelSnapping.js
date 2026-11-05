import { walls, polygon, partitionGeometry } from './domain.js';
import { ceilingStructure } from './architecture.js';
import { frameGeometry } from './steelFrames.js';
import { STEEL_LINE_PLANES } from './steelLinePlacement.js';

const EPS = 0.51; // Stored coordinates are rounded to integer millimetres.
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Targets use the model's millimetre coordinates, never the preview or comparison layout.
export function steelSnapGeometry(project) {
  const steel = { points: [], edges: [] },
    building = { points: [], edges: [] };
  const point = (group, p, label) => group.points.push({ point: p, label });
  const edge = (group, a, b, label) => group.edges.push({ a, b, label });
  const loop = (nodes, label) => {
    nodes.forEach((p) => point(building, p, `${label}の角`));
    nodes.forEach((p, i) => edge(building, p, nodes[(i + 1) % nodes.length], `${label}の辺`));
  };
  const box = (width, height, depth, x, y, z, rotation, label) => {
    const c = Math.cos(rotation),
      s = Math.sin(rotation);
    const nodes = [0, 1].flatMap((iy) =>
      [0, 1].flatMap((iz) =>
        [0, 1].map((ix) => {
          const dx = (ix - 0.5) * width,
            dz = (iz - 0.5) * depth;
          return [x + dx * c + dz * s, y + (iy - 0.5) * height, z - dx * s + dz * c];
        }),
      ),
    );
    nodes.forEach((p) => point(building, p, `${label}の角`));
    nodes.forEach((p, i) => {
      for (const bit of [1, 2, 4])
        if (!(i & bit)) edge(building, p, nodes[i | bit], `${label}の辺`);
    });
  };
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId);
  for (const frame of layout?.steelFrames || []) {
    const { nodes, shape } = frameGeometry(frame, project);
    nodes.forEach((p) => point(steel, p, '鉄骨の端点'));
    shape.members.forEach(([i, j]) => edge(steel, nodes[i], nodes[j], '鉄骨の部材'));
  }
  const b = project.building;
  for (const y of [0, b.height])
    loop(
      polygon(b).map(([x, z]) => [x, y, z]),
      y ? '天井' : '床',
    );
  for (const wall of walls(b)) {
    const { start: a, end: z } = wall;
    loop(
      [
        [a.x, 0, a.z],
        [z.x, 0, z.z],
        [z.x, wall.height, z.z],
        [a.x, wall.height, a.z],
      ],
      '建物の壁',
    );
  }
  for (const p of layout?.partitions || []) {
    const g = partitionGeometry(p, project.rails);
    box(p.width, p.height, p.thickness, g.x, p.height / 2, g.z, g.rotation, '可動壁');
  }
  for (const member of ceilingStructure(b, project.rails).members)
    if (member.kind === 'carrier-concrete' || member.kind.startsWith('concrete-only'))
      box(
        member.length,
        member.depth,
        member.width,
        member.x,
        member.y,
        member.z,
        member.rotation,
        '梁',
      );
  const west = b.mainWidth - b.overallWidth,
    junction = b.length - b.wingDepth;
  box(
    -west,
    280,
    b.wingDepth - 4970,
    west / 2,
    b.mezzanineHeight,
    junction + (b.wingDepth - 4970) / 2,
    0,
    '中二階',
  );
  box(
    b.mainWidth,
    280,
    3650,
    b.mainWidth / 2,
    b.mezzanineHeight,
    b.length - 4970 - 3650 / 2,
    0,
    '中二階',
  );
  box(
    b.columnSize,
    b.height,
    b.columnSize,
    -b.columnSize / 2,
    b.height / 2,
    b.length - 4970 - b.columnSize / 2,
    0,
    '柱',
  );
  return {
    steel,
    all: {
      points: [...steel.points, ...building.points],
      edges: [...steel.edges, ...building.edges],
    },
  };
}

export function steelOrthogonalConstraint(tool, point) {
  if (!tool.orthogonal || !tool.start || !point) return null;
  const normal = STEEL_LINE_PLANES.find((p) => p.id === tool.plane).axis;
  const axes = [0, 1, 2].filter((i) => i !== normal);
  const axis = axes.reduce((best, i) =>
    Math.abs(point[i] - tool.start[i]) > Math.abs(point[best] - tool.start[best]) ? i : best,
  );
  return { origin: tool.start, axes: [axis] };
}
export function constrainSteelPoint(point, constraint) {
  return (
    point &&
    point.map((v, i) => (!constraint || constraint.axes.includes(i) ? v : constraint.origin[i]))
  );
}
function constrainedEdge(a, b, constraint) {
  if (!constraint) return [a, b];
  let t = null;
  for (let i = 0; i < 3; i++) {
    if (constraint.axes.includes(i)) continue;
    const delta = b[i] - a[i],
      distance = constraint.origin[i] - a[i];
    if (Math.abs(delta) < 1e-7) {
      if (Math.abs(distance) > EPS) return null;
    } else {
      const next = distance / delta;
      if (
        next < 0 ||
        next > 1 ||
        (t !== null && Math.abs(next - t) * Math.hypot(...b.map((v, j) => v - a[j])) > EPS)
      )
        return null;
      t = next;
    }
  }
  if (t === null) return [constrainSteelPoint(a, constraint), constrainSteelPoint(b, constraint)];
  const p = constrainSteelPoint(lerp(a, b, t), constraint);
  return [p, p];
}

// project() returns CSS-pixel x/y, clip depth, and signed camera depth w.
// project.near is the camera's near plane in the same units as w.
// Point targets take precedence over edges inside the same 12px acquisition radius.
export function snapSteelPoint(
  point,
  targets,
  project,
  { cursor, constraint = null, radius = 12, enabled = true } = {},
) {
  if (!point || !enabled) return null;
  const pointer = cursor || project(point);
  if (!pointer || (!cursor && pointer.w !== undefined && pointer.w <= 0)) return null;
  const distance = (p) => {
    const q = project(p);
    return !q ||
      (q.w !== undefined && q.w <= 0) ||
      (q.depth !== undefined && (q.depth < -1 || q.depth > 1))
      ? Infinity
      : Math.hypot(q.x - pointer.x, q.y - pointer.y);
  };
  const allowed = (p) =>
    !constraint ||
    p.every((v, i) => constraint.axes.includes(i) || Math.abs(v - constraint.origin[i]) <= EPS);
  let best = null,
    closest = radius;
  const consider = (p, label) => {
    if (!allowed(p)) return;
    const rounded = constrainSteelPoint(p.map(Math.round), constraint),
      d = distance(rounded);
    if (d < closest) {
      closest = d;
      best = { point: rounded, label };
    }
  };
  for (const target of targets.points) consider(target.point, target.label);
  if (best) return best;
  for (const target of targets.edges) {
    const segment = constrainedEdge(target.a, target.b, constraint);
    if (!segment) continue;
    let [a, b] = segment,
      pa = project(a),
      pb = project(b);
    if (!pa || !pb) continue;
    if (pa.w !== undefined && pb.w !== undefined) {
      const near = project.near || 1e-6;
      if (pa.w < near && pb.w < near) continue;
      // Clip in world space before projecting an edge that crosses the camera plane.
      if (pa.w < near) {
        a = lerp(a, b, (near - pa.w) / (pb.w - pa.w));
        pa = project(a);
      } else if (pb.w < near) {
        b = lerp(a, b, (near - pa.w) / (pb.w - pa.w));
        pb = project(b);
      }
    }
    if (!pa || !pb || ![pa.x, pa.y, pb.x, pb.y].every(Number.isFinite)) continue;
    const dx = pb.x - pa.x,
      dy = pb.y - pa.y,
      length = dx * dx + dy * dy;
    const u = length
      ? Math.max(0, Math.min(1, ((pointer.x - pa.x) * dx + (pointer.y - pa.y) * dy) / length))
      : 0;
    // Recover the world-space parameter from the perspective screen-space fraction.
    const wa = pa.w || 1,
      wb = pb.w || 1;
    const t = (u * wa) / ((1 - u) * wb + u * wa);
    consider(lerp(a, b, t), target.label);
  }
  return best;
}
