import silhouettes from './silhouettes.json' with { type: 'json' };

export { silhouettes };
export const OBJECT_KINDS = [
  ['box', 'ボックス'],
  ['plane', '平面'],
  ['table', '机'],
  ['cylinder', '円柱・柱'],
  ['sphere', '球・楕円体'],
  ['polygon', '多角形'],
];
export const DEFAULT_OUTLINE = [
  [0, 0],
  [1, 0],
  [1, 0.5],
  [0.5, 0.5],
  [0.5, 1],
  [0, 1],
];
export const silhouetteFor = (object) => silhouettes.find((s) => s.id === object.silhouetteId);

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function validateOutline(points) {
  const fail = () => {
    throw new Error('輪郭は交差しない3〜64個の頂点で指定してください');
  };
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > 64 ||
    points.some(
      (p) =>
        !Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isFinite(v) || v < 0 || v > 1),
    )
  )
    fail();
  const eps = 1e-9,
    n = points.length;
  const on = (a, b, p) =>
    Math.abs(cross(a, b, p)) < eps &&
    p.every((v, i) => v >= Math.min(a[i], b[i]) - eps && v <= Math.max(a[i], b[i]) + eps);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i],
      b = points[(i + 1) % n];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < eps) fail();
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % n];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        fail();
    }
  }
  if (Math.abs(area) < eps) fail();
  // Normalise the drawn outline so the requested width/depth are its actual bounds.
  const min = [0, 1].map((i) => Math.min(...points.map((p) => p[i])));
  const size = [0, 1].map((i) => Math.max(...points.map((p) => p[i])) - min[i]);
  return points.map((p) => p.map((v, i) => (v - min[i]) / size[i]));
}

export function validateSceneObject(object) {
  if (
    !object ||
    typeof object.id !== 'string' ||
    !object.id ||
    object.id.length > 200 ||
    typeof object.name !== 'string' ||
    !object.name.trim() ||
    object.name.length > 200 ||
    ![...OBJECT_KINDS.map(([kind]) => kind), 'silhouette'].includes(object.kind)
  )
    throw new Error('形状データが不正です');
  for (const key of ['width', 'height', 'depth'])
    if (!Number.isInteger(object[key]) || object[key] < 1 || object[key] > 100000)
      throw new Error('寸法は1〜100,000 mmの整数で指定してください');
  if (
    ![object.x, object.y, object.z, object.rotation].every(Number.isInteger) ||
    Math.abs(object.x) > 1000000 ||
    Math.abs(object.z) > 1000000 ||
    object.y < 0 ||
    object.y > 100000 ||
    Math.abs(object.rotation) > 360000
  )
    throw new Error('位置・回転の指定が不正です');
  if (
    typeof object.color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(object.color) ||
    !Number.isFinite(object.opacity) ||
    object.opacity < 0 ||
    object.opacity > 1
  )
    throw new Error('色・透明度の指定が不正です');
  if (object.kind === 'plane' && !['vertical', 'horizontal'].includes(object.orientation))
    throw new Error('平面の向きを選んでください');
  if (object.kind === 'polygon') object.points = validateOutline(object.points);
  if (object.kind === 'silhouette') {
    const silhouette = silhouetteFor(object);
    if (!silhouette) throw new Error('人物シルエットを選んでください');
    object.y = 0;
    object.color = '#808080';
    object.width = Math.max(1, Math.round(silhouette.aspect * object.height));
    object.depth = 1;
  }
  return object;
}

export function newSceneObject(kind, building, options = {}, id = crypto.randomUUID()) {
  return validateSceneObject({
    id,
    kind,
    name: OBJECT_KINDS.find(([key]) => key === kind)?.[1] || '人物シルエット',
    width: 1000,
    height: kind === 'table' ? 720 : 1000,
    depth: kind === 'table' ? 700 : 1000,
    x: Math.round(building.mainWidth / 2),
    y: 0,
    z: Math.round(building.length / 2),
    rotation: 0,
    color: '#b8b5ac',
    opacity: kind === 'silhouette' ? 0.5 : 1,
    ...(kind === 'plane' ? { orientation: 'vertical' } : {}),
    ...(kind === 'polygon' ? { points: structuredClone(DEFAULT_OUTLINE) } : {}),
    ...(kind === 'silhouette' ? { silhouetteId: silhouettes[0].id, height: 1700 } : {}),
    ...options,
  });
}

export function validateSceneObjects(project) {
  for (const layout of project.layouts) {
    layout.sceneObjects ??= [];
    if (
      !Array.isArray(layout.sceneObjects) ||
      layout.sceneObjects.length > 1000 ||
      new Set(layout.sceneObjects.map((o) => o?.id)).size !== layout.sceneObjects.length
    )
      throw new Error('形状・人物は1プランに1,000点以内、IDは重複しないようにしてください');
    layout.sceneObjects.forEach(validateSceneObject);
  }
}

export function objectFootprint(object) {
  const { width: w, depth: d } = object;
  let points;
  if (object.kind === 'polygon')
    points = object.points.map(([x, z]) => [(x - 0.5) * w, (z - 0.5) * d]);
  else if (['cylinder', 'sphere'].includes(object.kind))
    points = Array.from({ length: 40 }, (_, i) => [
      (Math.cos((i * Math.PI) / 20) * w) / 2,
      (Math.sin((i * Math.PI) / 20) * d) / 2,
    ]);
  else {
    const depth =
      object.kind === 'silhouette' || (object.kind === 'plane' && object.orientation === 'vertical')
        ? 1
        : d;
    points = [
      [-w / 2, -depth / 2],
      [w / 2, -depth / 2],
      [w / 2, depth / 2],
      [-w / 2, depth / 2],
    ];
  }
  const angle = (object.rotation * Math.PI) / 180;
  return points.map(([x, z]) => [
    object.x + x * Math.cos(angle) + z * Math.sin(angle),
    object.z - x * Math.sin(angle) + z * Math.cos(angle),
  ]);
}
