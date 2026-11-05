// Detect the bounded regions of coplanar line arrangements. All coordinates are mm.
const EPS = 0.01;
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const area = (points) =>
  points.reduce((sum, p, i) => sum + cross2(p, points[(i + 1) % points.length]), 0) / 2;
const cache = new WeakMap();
export const steelLineFaceId = (ids) => `line-face:${JSON.stringify([...new Set(ids)].sort())}`;

function strictlyInside(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i],
      d = sub(b, a),
      q = sub(point, a),
      length = Math.hypot(...d);
    if (
      Math.abs(cross2(d, q)) / length < EPS &&
      dot(q, d) >= -EPS &&
      dot(q, d) <= length * length + EPS
    )
      return false;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function planeRegions(plane, lines) {
  const { n, u, v, d } = plane;
  const project = (p) => [dot(p, u), dot(p, v)];
  const lift = (p) => u.map((value, i) => value * p[0] + v[i] * p[1] + n[i] * d);
  const segments = lines
    .filter((l) => Math.abs(dot(l.start, n) - d) < EPS && Math.abs(dot(l.end, n) - d) < EPS)
    .map((l) => ({ ...l, a: project(l.start), b: project(l.end), cuts: [0, 1] }));
  if (segments.length < 3) return [];
  const addCut = (segment, t) => {
    if (t >= -1e-9 && t <= 1 + 1e-9) segment.cuts.push(Math.max(0, Math.min(1, t)));
  };
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j],
        r = sub(a.b, a.a),
        s = sub(b.b, b.a),
        q = sub(b.a, a.a),
        den = cross2(r, s);
      if (Math.abs(den) > 1e-10 * Math.hypot(...r) * Math.hypot(...s)) {
        const t = cross2(q, s) / den,
          w = cross2(q, r) / den;
        if (t >= -1e-9 && t <= 1 + 1e-9 && w >= -1e-9 && w <= 1 + 1e-9) {
          addCut(a, t);
          addCut(b, w);
        }
      } else if (Math.abs(cross2(r, q)) / Math.hypot(...r) < EPS) {
        for (const p of [b.a, b.b]) addCut(a, dot(sub(p, a.a), r) / dot(r, r));
        for (const p of [a.a, a.b]) addCut(b, dot(sub(p, b.a), s) / dot(s, s));
      }
    }
  const nodes = new Map(),
    nodeBuckets = new Map(),
    edges = new Map(),
    adj = new Map();
  const node = (p) => {
    const cell = p.map((value) => Math.floor(value / EPS));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of nodeBuckets.get(`${cell[0] + dx},${cell[1] + dy}`) || []) {
          const q = nodes.get(id);
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= EPS) return id;
        }
    const id = String(nodes.size),
      key = cell.join(',');
    nodes.set(id, p);
    if (!nodeBuckets.has(key)) nodeBuckets.set(key, []);
    nodeBuckets.get(key).push(id);
    return id;
  };
  for (const segment of segments) {
    const cuts = [...new Set(segment.cuts)].sort((a, b) => a - b),
      delta = sub(segment.b, segment.a);
    for (let i = 1; i < cuts.length; i++) {
      const a = node(segment.a.map((value, k) => value + delta[k] * cuts[i - 1]));
      const b = node(segment.a.map((value, k) => value + delta[k] * cuts[i]));
      if (a === b) continue;
      const key = [a, b].sort().join('|'),
        existing = edges.get(key);
      if (!existing || segment.id < existing.lineId) edges.set(key, { a, b, lineId: segment.id });
    }
  }
  for (const { a, b } of edges.values()) {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  // Open tails cannot bound a membrane.
  const leaves = [...adj].filter(([, neighbors]) => neighbors.size < 2).map(([id]) => id);
  while (leaves.length) {
    const id = leaves.pop(),
      neighbors = adj.get(id);
    if (!neighbors) continue;
    for (const next of neighbors) {
      adj.get(next)?.delete(id);
      if (adj.get(next)?.size === 1) leaves.push(next);
    }
    adj.delete(id);
  }
  const ordered = new Map(
    [...adj].map(([id, neighbors]) => [
      id,
      [...neighbors].sort((a, b) => {
        const p = nodes.get(id),
          x = sub(nodes.get(a), p),
          y = sub(nodes.get(b), p);
        return Math.atan2(x[1], x[0]) - Math.atan2(y[1], y[0]);
      }),
    ]),
  );
  const visited = new Set(),
    cycles = new Map();
  for (const [from, neighbors] of ordered)
    for (const to of neighbors) {
      if (visited.has(`${from}|${to}`)) continue;
      const walk = [];
      let a = from,
        b = to;
      while (!visited.has(`${a}|${b}`)) {
        visited.add(`${a}|${b}`);
        walk.push({ a, b, ...{ lineId: edges.get([a, b].sort().join('|')).lineId } });
        const around = ordered.get(b),
          index = around.indexOf(a),
          next = around[(index + around.length - 1) % around.length];
        a = b;
        b = next;
      }
      if (a !== from || b !== to) continue;
      // Split repeated vertices so bridges between loops do not create self-touching polygons.
      let path = [from],
        pathEdges = [],
        indices = new Map([[from, 0]]);
      for (const edge of walk) {
        pathEdges.push(edge);
        if (indices.has(edge.b)) {
          const index = indices.get(edge.b),
            ids = path.slice(index),
            boundary = pathEdges.slice(index);
          const points = ids.map((id) => nodes.get(id)),
            size = area(points);
          if (ids.length >= 3 && size > 1) {
            const lineIds = [...new Set(boundary.map((e) => e.lineId))].sort();
            if (lineIds.length >= 3)
              cycles.set(steelLineFaceId(lineIds), {
                projected: points,
                points: points.map(lift),
                lineIds,
                area: size,
                holes: [],
              });
          }
          path = path.slice(0, index + 1);
          pathEdges = pathEdges.slice(0, index);
          indices = new Map(path.map((id, i) => [id, i]));
        } else {
          indices.set(edge.b, path.length);
          path.push(edge.b);
        }
      }
    }
  const regions = [...cycles.values()];
  // Disconnected nested loops form a hole in the surrounding region and an independent inner face.
  for (const child of regions) {
    const parents = regions
      .filter(
        (p) =>
          p.area > child.area + 1 &&
          child.projected.every((point) => strictlyInside(point, p.projected)),
      )
      .sort((a, b) => a.area - b.area);
    if (parents.length)
      parents[0].holes.push({
        points: child.points,
        projected: child.projected,
        lineIds: child.lineIds,
        area: child.area,
      });
  }
  return regions.map((region) => {
    const lineIds = [
      ...new Set([...region.lineIds, ...region.holes.flatMap((h) => h.lineIds)]),
    ].sort();
    return {
      ...region,
      normal: n,
      lineIds,
      id: steelLineFaceId(lineIds),
      area: region.area - region.holes.reduce((sum, h) => sum + h.area, 0),
    };
  });
}
export function detectSteelLineFaces(frames) {
  if (cache.has(frames)) return cache.get(frames);
  const lines = frames
    .filter((f) => f.kind === 'line')
    .map((f) => ({
      id: f.id,
      start: [f.x, f.y, f.z],
      end: f.lineEnd.map((x, i) => x + [f.x, f.y, f.z][i]),
    }));
  const planes = new Map();
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j],
        r = sub(a.end, a.start),
        s = sub(b.end, b.start),
        normal = cross(r, s),
        length = Math.hypot(...normal);
      if (length < 1e-8 * Math.hypot(...r) * Math.hypot(...s)) continue;
      let n = normal.map((x) => x / length);
      const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
      if (n[axis] < 0) n = n.map((x) => -x);
      const d = dot(n, a.start);
      if (Math.abs(dot(n, b.start) - d) > EPS || Math.abs(dot(n, b.end) - d) > EPS) continue;
      const key = [...n.map((x) => Math.round(x * 1e7)), Math.round(d * 100)].join(',');
      if (!planes.has(key)) {
        const u = r.map((x) => x / Math.hypot(...r));
        planes.set(key, { n, d, u, v: cross(n, u) });
      }
    }
  const faces = new Map();
  for (const plane of planes.values())
    for (const region of planeRegions(plane, lines)) faces.set(region.id, region);
  const result = [...faces.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((face, i) => ({ ...face, name: `ライン面 ${i + 1}` }));
  cache.set(frames, result);
  return result;
}
export function validateSteelLineMembranes(project) {
  for (const layout of project.layouts) {
    layout.steelLineMembranes ??= [];
    const styles = layout.steelLineMembranes,
      ids = new Set(layout.steelFrames.filter((f) => f.kind === 'line').map((f) => f.id));
    if (
      !Array.isArray(styles) ||
      styles.length > 2000 ||
      new Set(styles.map((s) => s?.faceId)).size !== styles.length
    )
      throw new Error('ライン面の膜一覧が不正です');
    for (const s of styles)
      if (
        !s ||
        !Array.isArray(s.lineIds) ||
        s.lineIds.length < 3 ||
        s.lineIds.length > 200 ||
        new Set(s.lineIds).size !== s.lineIds.length ||
        !s.lineIds.every((id) => ids.has(id)) ||
        s.faceId !== steelLineFaceId(s.lineIds) ||
        !/^#[0-9a-f]{6}$/i.test(s.color) ||
        !Number.isFinite(s.opacity) ||
        s.opacity < 0 ||
        s.opacity > 1
      )
        throw new Error('ライン面の膜の参照・色・不透明度が不正です');
  }
}
export function pruneSteelLineMembranes(project) {
  for (const layout of project.layouts) {
    const ids = new Set(layout.steelFrames.filter((f) => f.kind === 'line').map((f) => f.id));
    if (layout.steelLineMembranes)
      layout.steelLineMembranes = layout.steelLineMembranes.filter((s) =>
        s.lineIds.every((id) => ids.has(id)),
      );
  }
}
