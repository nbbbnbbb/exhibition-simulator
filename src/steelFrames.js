// Frame coordinates and section polygons are millimetres. Instances use a base-centre origin.
export const FRAME_SHAPES = [
  {
    id: 'rectangle',
    name: '矩形',
    nodes: [
      [0, 0, 0],
      [3000, 0, 0],
      [3000, 2400, 0],
      [0, 2400, 0],
    ],
    members: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    faces: [{ name: '正面', nodes: [0, 1, 2, 3] }],
  },
  {
    id: 'box',
    name: 'ボックス',
    nodes: [
      [0, 0, 0],
      [3000, 0, 0],
      [3000, 2400, 0],
      [0, 2400, 0],
      [0, 0, 2000],
      [3000, 0, 2000],
      [3000, 2400, 2000],
      [0, 2400, 2000],
    ],
    members: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ],
    faces: [
      { name: '正面', nodes: [0, 1, 2, 3] },
      { name: '背面', nodes: [4, 5, 6, 7] },
      { name: '左面', nodes: [0, 3, 7, 4] },
      { name: '右面', nodes: [1, 5, 6, 2] },
      { name: '上面', nodes: [3, 2, 6, 7] },
      { name: '下面', nodes: [0, 4, 5, 1] },
    ],
  },
  {
    id: 'portal',
    name: '門形（下辺なし）',
    nodes: [
      [0, 0, 0],
      [0, 2400, 0],
      [3000, 2400, 0],
      [3000, 0, 0],
    ],
    members: [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
    faces: [],
  },
  {
    id: 'triangle',
    name: '三角形',
    nodes: [
      [0, 0, 0],
      [3000, 0, 0],
      [1500, 2400, 0],
    ],
    members: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
    faces: [{ name: '正面', nodes: [0, 1, 2] }],
  },
];
export const STEEL_SECTIONS = [
  {
    id: 'c65',
    name: 'C形 65 × 30 × 10 × 0.8',
    kind: 'c',
    width: 65,
    depth: 30,
    lip: 10,
    thickness: 0.8,
  },
  { id: 'u67', name: 'U形 67 × 30 × 0.8', kind: 'u', width: 67, depth: 30, thickness: 0.8 },
  {
    id: 'tube25',
    name: '角パイプ 25 × 25 × 1.2',
    kind: 'tube',
    width: 25,
    depth: 25,
    thickness: 1.2,
  },
  { id: 'l30', name: 'L形 30 × 30 × 1.6', kind: 'l', width: 30, depth: 30, thickness: 1.6 },
];
export const frameShapes = (p) => [...FRAME_SHAPES, ...(p.frameShapes || [])];
export const steelSections = (p) => [...STEEL_SECTIONS, ...(p.steelSections || [])];
export function shapeBounds(shape) {
  const min = [0, 1, 2].map((i) => Math.min(...shape.nodes.map((n) => n[i])));
  const max = [0, 1, 2].map((i) => Math.max(...shape.nodes.map((n) => n[i])));
  return { min, size: max.map((v, i) => v - min[i]) };
}
const nodeCache = new Map();
export function localFrameNodes(f, shape, section) {
  const { min, size } = shapeBounds(shape);
  const loops = sectionLoops(section),
    key = JSON.stringify([shape.nodes, shape.members, loops, f.width, f.height, f.depth]);
  if (nodeCache.has(key)) return nodeCache.get(key);
  const target = [f.width, f.height, f.depth],
    span = [...target];
  let points, bounds;
  // Account for each member's oriented section, so dimensions describe the actual outer envelope.
  for (let iteration = 0; iteration < 16; iteration++) {
    points = shape.nodes.map((n) =>
      n.map((v, i) => (size[i] ? ((v - min[i]) / size[i]) * span[i] : 0)),
    );
    bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const [a, b] of shape.members) {
      const delta = points[b].map((v, i) => v - points[a][i]),
        length = Math.hypot(...delta),
        d = delta.map((v) => v / length);
      const inv = d[2] < -0.999999999 ? 0 : 1 / Math.sqrt(2 * (1 + d[2]));
      const q = d[2] < -0.999999999 ? [1, 0, 0, 0] : [-d[1] * inv, d[0] * inv, 0, (1 + d[2]) * inv];
      for (const [x, y] of loops[0]) {
        const t = [-2 * q[2] * y, 2 * q[2] * x, 2 * (q[0] * y - q[1] * x)];
        const offset = [
          x + q[3] * t[0] + q[1] * t[2] - q[2] * t[1],
          y + q[3] * t[1] + q[2] * t[0] - q[0] * t[2],
          q[3] * t[2] + q[0] * t[1] - q[1] * t[0],
        ];
        for (const index of [a, b])
          for (let i = 0; i < 3; i++) {
            const v = points[index][i] + offset[i];
            bounds.min[i] = Math.min(bounds.min[i], v);
            bounds.max[i] = Math.max(bounds.max[i], v);
          }
      }
    }
    const error = target.map((v, i) => (size[i] ? v - (bounds.max[i] - bounds.min[i]) : 0));
    if (Math.max(...error.map(Math.abs)) < 0.000001 || iteration === 15) break;
    error.forEach((e, i) => {
      span[i] = Math.max(0.01, span[i] + e);
    });
  }
  const result = points.map((n) =>
    n.map((v, i) => v - (i === 1 ? bounds.min[i] : (bounds.min[i] + bounds.max[i]) / 2)),
  );
  if (nodeCache.size >= 256) nodeCache.delete(nodeCache.keys().next().value);
  nodeCache.set(key, result);
  return result;
}
export function sectionLoops(s) {
  if (s.kind === 'custom') return [s.points];
  const w = s.width,
    d = s.depth,
    t = s.thickness,
    l = s.lip;
  let outer,
    holes = [];
  if (s.kind === 'tube') {
    outer = [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ];
    holes = [
      [
        [t, t],
        [t, d - t],
        [w - t, d - t],
        [w - t, t],
      ],
    ];
  } else if (s.kind === 'l')
    outer = [
      [0, 0],
      [w, 0],
      [w, t],
      [t, t],
      [t, d],
      [0, d],
    ];
  else if (s.kind === 'u')
    outer = [
      [0, 0],
      [w, 0],
      [w, d],
      [w - t, d],
      [w - t, t],
      [t, t],
      [t, d],
      [0, d],
    ];
  else
    outer = [
      [0, 0],
      [w, 0],
      [w, d],
      [w - l, d],
      [w - l, d - t],
      [w - t, d - t],
      [w - t, t],
      [t, t],
      [t, d - t],
      [l, d - t],
      [l, d],
      [0, d],
    ];
  return [outer, ...holes].map((loop) => loop.map(([x, y]) => [x - w / 2, y - d / 2]));
}
export function sectionRadius(s) {
  return Math.max(
    ...sectionLoops(s)
      .flat()
      .map(([x, y]) => Math.hypot(x, y)),
  );
}
export function frameGeometry(f, p) {
  if (f.kind === 'line') {
    const local = [[0, 0, 0], f.lineEnd];
    return {
      shape: { id: 'line', name: 'ライン', nodes: local, members: [[0, 1]], faces: [] },
      section: steelSections(p).find((s) => s.id === f.sectionId),
      local,
      nodes: local.map(([x, y, z]) => [f.x + x, f.y + y, f.z + z]),
    };
  }
  const shape = frameShapes(p).find((s) => s.id === f.shapeId);
  const section = steelSections(p).find((s) => s.id === f.sectionId);
  const local = localFrameNodes(f, shape, section);
  const a = (f.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const nodes = local.map(([x, y, z]) => [f.x + x * c + z * s, f.y + y, f.z - x * s + z * c]);
  return { shape, section, local, nodes };
}
export function validateFrame(f, p) {
  if (f?.kind === 'line') return validateSteelLine(f, p);
  if (
    !f ||
    f.kind !== undefined ||
    typeof f.id !== 'string' ||
    !f.id ||
    typeof f.name !== 'string' ||
    f.name.length > 200 ||
    !frameShapes(p).some((s) => s.id === f.shapeId) ||
    !steelSections(p).some((s) => s.id === f.sectionId) ||
    ![f.width, f.height, f.depth, f.x, f.y, f.z, f.rotation].every(Number.isSafeInteger) ||
    f.width < 100 ||
    f.width > 30000 ||
    f.height < 100 ||
    f.height > 20000 ||
    f.depth < 0 ||
    f.depth > 30000 ||
    f.rotation < -360 ||
    f.rotation > 360
  )
    throw new Error('鉄骨フレームの形状・寸法・座標が不正です');
  const g = frameGeometry(f, p),
    r = sectionRadius(g.section);
  if (f.width <= 2 * r || f.height <= 2 * r || (shapeBounds(g.shape).size[2] && f.depth <= 2 * r))
    throw new Error('フレームの外寸を部材断面より大きくしてください');
  if (!shapeBounds(g.shape).size[2] && f.depth !== 0) throw new Error('平面形状の奥行は0 mmです');
  if (
    !f.membrane ||
    !/^#[0-9a-f]{6}$/i.test(f.membrane.color) ||
    !Number.isFinite(f.membrane.opacity) ||
    f.membrane.opacity < 0 ||
    f.membrane.opacity > 1 ||
    !Array.isArray(f.membrane.faces) ||
    new Set(f.membrane.faces).size !== f.membrane.faces.length ||
    !f.membrane.faces.every((i) => Number.isInteger(i) && i >= 0 && i < g.shape.faces.length)
  )
    throw new Error('ビニール膜の設定が不正です');
  return f;
}
export function validateSteelLine(f, p) {
  const section = steelSections(p).find((s) => s.id === f.sectionId);
  if (
    typeof f.id !== 'string' ||
    !f.id ||
    typeof f.name !== 'string' ||
    f.name.length > 200 ||
    !section ||
    ![f.x, f.y, f.z].every(Number.isSafeInteger) ||
    !Array.isArray(f.lineEnd) ||
    f.lineEnd.length !== 3 ||
    !f.lineEnd.every(Number.isSafeInteger) ||
    f.rotation !== 0 ||
    !f.membrane ||
    !Array.isArray(f.membrane.faces) ||
    f.membrane.faces.length ||
    !/^#[0-9a-f]{6}$/i.test(f.membrane.color) ||
    !Number.isFinite(f.membrane.opacity) ||
    f.membrane.opacity < 0 ||
    f.membrane.opacity > 1
  )
    throw new Error('鉄骨ラインの端点・部材断面が不正です');
  const length = Math.hypot(...f.lineEnd);
  if (length < 100 || length > 30000)
    throw new Error('鉄骨ラインの長さは100〜30,000 mmにしてください');
  if (!f.lineEnd.map((v, i) => v + [f.x, f.y, f.z][i]).every(Number.isSafeInteger))
    throw new Error('鉄骨ラインの座標が不正です');
  return f;
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function simplePolygon(points) {
  if (
    points.length < 3 ||
    points.length > 32 ||
    !points.every((n) => Array.isArray(n) && n.length === 2 && n.every(Number.isFinite))
  )
    return false;
  if (new Set(points.map((p) => p.join(','))).size !== points.length) return false;
  const area = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  if (Math.abs(area) < 0.01) return false;
  const on = (a, b, c) =>
    Math.abs(cross(a, b, c)) < 1e-8 &&
    c[0] >= Math.min(a[0], b[0]) &&
    c[0] <= Math.max(a[0], b[0]) &&
    c[1] >= Math.min(a[1], b[1]) &&
    c[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const a = points[i],
        b = points[(i + 1) % points.length],
        c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return false;
    }
  return true;
}
export function validateFrameShape(s) {
  if (
    !s ||
    typeof s.id !== 'string' ||
    !s.id ||
    typeof s.name !== 'string' ||
    !s.name.trim() ||
    s.name.length > 200 ||
    !Array.isArray(s.nodes) ||
    s.nodes.length < 3 ||
    s.nodes.length > 64 ||
    !s.nodes.every(
      (n) =>
        Array.isArray(n) &&
        n.length === 3 &&
        n.every((v) => Number.isFinite(v) && Math.abs(v) <= 30000),
    ) ||
    new Set(s.nodes.map((n) => n.join(','))).size !== s.nodes.length ||
    !Array.isArray(s.members) ||
    !s.members.length ||
    s.members.length > 128 ||
    !Array.isArray(s.faces) ||
    s.faces.length > 32
  )
    throw new Error('形状は3〜64頂点、1〜128部材、32面以内で指定してください');
  const size = shapeBounds(s).size;
  if (size[0] < 100 || size[1] < 100 || size.some((v) => v > 30000))
    throw new Error('形状の幅・高さは100〜30,000 mm、奥行は30,000 mm以内です');
  const index = (n) => Number.isInteger(n) && n >= 0 && n < s.nodes.length;
  const keys = new Set();
  for (const edge of s.members) {
    if (!Array.isArray(edge) || edge.length !== 2 || !edge.every(index) || edge[0] === edge[1])
      throw new Error('部材の頂点番号が不正です');
    const k = [...edge].sort((a, b) => a - b).join(',');
    if (keys.has(k)) throw new Error('同じ部材が重複しています');
    keys.add(k);
  }
  if (s.nodes.some((_, i) => !s.members.some((e) => e.includes(i))))
    throw new Error('すべての頂点を部材に接続してください');
  for (const face of s.faces) {
    if (
      !face ||
      typeof face.name !== 'string' ||
      face.name.length > 200 ||
      !Array.isArray(face.nodes) ||
      face.nodes.length < 3 ||
      face.nodes.length > 32 ||
      !face.nodes.every(index) ||
      new Set(face.nodes).size !== face.nodes.length
    )
      throw new Error('膜を貼る面の頂点番号が不正です');
    const ps = face.nodes.map((i) => s.nodes[i]),
      a = ps[0],
      b = ps[1],
      c = ps[2];
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      len = Math.hypot(...n);
    if (
      len < 0.01 ||
      ps.some((q) => Math.abs(q.reduce((sum, x, i) => sum + (x - a[i]) * n[i], 0)) / len > 0.01)
    )
      throw new Error('膜の面は同一平面の凸多角形で指定してください');
    const axis = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
    const flat = ps.map((q) => q.filter((_, i) => i !== axis));
    const turns = flat.map((q, i) =>
      cross(q, flat[(i + 1) % flat.length], flat[(i + 2) % flat.length]),
    );
    if (!simplePolygon(flat) || (turns.some((t) => t > 1e-6) && turns.some((t) => t < -1e-6)))
      throw new Error('膜の面は交差しない凸多角形にしてください');
    for (let i = 0; i < face.nodes.length; i++)
      if (
        !keys.has(
          [face.nodes[i], face.nodes[(i + 1) % face.nodes.length]].sort((a, b) => a - b).join(','),
        )
      )
        throw new Error('膜の周囲に部材を登録してください');
  }
  return s;
}
export function validateSteelSection(s) {
  if (
    !s ||
    typeof s.id !== 'string' ||
    !s.id ||
    typeof s.name !== 'string' ||
    !s.name.trim() ||
    s.name.length > 200 ||
    s.kind !== 'custom' ||
    !Array.isArray(s.points) ||
    !simplePolygon(s.points) ||
    !s.points.every((n) => n.every((v) => Math.abs(v) <= 500))
  )
    throw new Error('独自断面は±500 mm内の交差しない3〜32頂点で指定してください');
  return s;
}
export function validateSteelProject(p) {
  p.frameShapes ??= [];
  p.steelSections ??= [];
  for (const [items, presets, validate] of [
    [p.frameShapes, FRAME_SHAPES, validateFrameShape],
    [p.steelSections, STEEL_SECTIONS, validateSteelSection],
  ]) {
    if (
      !Array.isArray(items) ||
      items.length > 100 ||
      new Set([...presets, ...items].map((s) => s?.id)).size !== presets.length + items.length
    )
      throw new Error('鉄骨の形状ライブラリが不正、またはIDが重複しています');
    items.forEach(validate);
  }
  for (const l of p.layouts) {
    l.steelFrames ??= [];
    if (
      !Array.isArray(l.steelFrames) ||
      l.steelFrames.length > 200 ||
      new Set(l.steelFrames.map((f) => f?.id)).size !== l.steelFrames.length
    )
      throw new Error('鉄骨フレーム一覧が不正です');
    l.steelFrames.forEach((f) => validateFrame(f, p));
  }
}
export function newSteelFrame(p, shapeId, id = crypto.randomUUID()) {
  const shape = frameShapes(p).find((s) => s.id === shapeId),
    size = shapeBounds(shape).size;
  const f = {
    id,
    name: `${shape.name}フレーム`,
    shapeId,
    sectionId: 'c65',
    width: Math.round(size[0]),
    height: Math.round(size[1]),
    depth: Math.round(size[2]),
    x: Math.round(p.building.mainWidth / 2),
    y: 0,
    z: 15000,
    rotation: 0,
    membrane: { faces: [], color: '#edf4ef', opacity: 0.35 },
  };
  return validateFrame(f, p);
}
