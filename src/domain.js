// Building and artwork dimensions use integer millimetres. Lighting uses lx, K and degrees.
import { lightingDefaults, validateLighting } from './lighting.js';
import { createRails } from './architecture.js';
import { validateSteelProject } from './steelFrames.js';
import { validateSteelLineMembranes } from './steelLineFaces.js';
import { DEFAULT_LABELS, LABEL_FIELDS } from './artworkLabels.js';
import {
  addSuppliedArtworks,
  placementProblem,
  validateArtworkMetadata,
  quantityLimit,
  placedCount,
} from './catalog.js';
export const SCHEMA_VERSION = 1;
export const uid = () => crypto.randomUUID();
export const mm = (n) => Math.round(Number(n));
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const format = (n) => Math.round(n).toLocaleString('ja-JP');
export const DEFAULT_BUILDING = {
  mainWidth: 8985,
  overallWidth: 19160,
  length: 45732,
  wingDepth: 14640,
  height: 5500,
  wallThickness: 180,
  beamDepth: 500,
  beamWidth: 300,
  beamPitch: 2650,
  mezzanineHeight: 3000,
  columnSize: 850,
  sideDoorAt: 27035,
  sideDoorWidth: 2057,
  eastDoorAt: 4750,
  eastDoorWidth: 1500,
};
export const DIMENSIONS = [
  {
    key: 'mainWidth',
    label: '主展示室の幅',
    source: '図面記載',
    value: '8,985 mm',
    note: '上端の水平寸法。内法として採用。',
  },
  {
    key: 'overallWidth',
    label: '全体幅',
    source: '図面記載',
    value: '19,160 mm',
    note: '下端の水平寸法。主室との差で西側の張り出しを定義。',
  },
  {
    key: 'length',
    label: '全長（暫定採用）',
    source: '寸法列から算出',
    value: '45,732 mm',
    note: '左寸法列 27,035 + 2,057 + 2,000 + 9,670 + 4,970 を連続する区間と暫定解釈。右列の合計42,970との差は2,762 mm。基準点・対象範囲が未特定であり、図面の誤りと断定しない。',
  },
  {
    key: 'wingDepth',
    label: '西側張り出しの奥行',
    source: '寸法列から算出',
    value: '14,640 mm',
    note: '9,670 + 4,970。張り出し幅は全体幅−主室幅=10,175。記載10,042との差133 mmは壁・基準線の不明差として保留。',
  },
  {
    key: 'height',
    label: '天井高',
    source: '推定',
    value: '5,500 mm',
    note: '寸法記載なし。展開図の比率と室内写真からの仮定。実測後に変更する。',
  },
  {
    key: 'beamDepth',
    label: '梁せい / 梁幅 / 間隔',
    source: '推定',
    value: '500 / 300 / 2,650 mm',
    note: 'レール付き梁の中心線は可動壁ラインに一致。2,650 mmはコンクリートのみの中間梁を配置する目安。断面・高さ・照明レールの取付詳細は写真からの推定。',
  },
  {
    key: 'mezzanineHeight',
    label: '中二階床高',
    source: '推定',
    value: '3,000 mm',
    note: '床の範囲・手すり・梁下高も写真から仮定。中二階は観察用で上階歩行は対象外。',
  },
  {
    key: 'columnSize',
    label: '柱幅・位置',
    source: '推定',
    value: '850 mm',
    note: '西側接合部の柱1本を写真・図面線から仮配置。柱中心は主室の西425 mm、南5,395 mm。',
  },
  {
    key: 'sideDoorAt',
    label: '西壁の扉',
    source: '図面記載',
    value: '27,035 / 2,057 mm',
    note: '北からの開口位置と幅。続く西壁2,000 mmを採用。',
  },
  {
    key: 'eastDoorAt',
    label: '東壁の開口',
    source: '一部推定',
    value: '4,750 / 1,500 mm',
    note: '4,750と括弧付き(1,500)を採用。南側出入口幅2,057 mmは西扉から転用した仮定。',
  },
  {
    key: 'other',
    label: 'その他の記載値',
    source: '未確定',
    value: '(2,500) / 3,650 mm',
    note: '寸法基準の解釈が未確定。3,650は南側中二階範囲の仮配置に使用。2,500は形状拘束に使っていない。',
  },
];
export function polygon(b) {
  const x = b.mainWidth - b.overallWidth,
    z = b.length - b.wingDepth;
  return [
    [0, 0],
    [b.mainWidth, 0],
    [b.mainWidth, b.length],
    [x, b.length],
    [x, z],
    [0, z],
  ];
}
export function walls(b, partitions = [], rails = []) {
  const x = b.mainWidth - b.overallWidth,
    z = b.length - b.wingDepth;
  const raw = [
    ['west', 'A · 主室 西壁', 0, 0, 0, b.sideDoorAt, 1, 0, true],
    ['west-return', 'B · 西壁 扉の南', 0, b.sideDoorAt + b.sideDoorWidth, 0, z, 1, 0, true],
    ['wing-north', 'C · 西室 北壁', x, z, 0, z, 0, 1, true],
    ['wing-west', 'D · 西室 西壁', x, z, x, b.length, 1, 0, true],
    ['wing-south', 'E · 西室 南壁', x, b.length, 0, b.length, 0, -1, true],
    ['south', 'F · 南面ガラス', 0, b.length, b.mainWidth, b.length, 0, -1, false],
    [
      'east-south',
      'G · 東壁 出入口脇',
      b.mainWidth,
      b.length - 2500 + 2057,
      b.mainWidth,
      b.length,
      -1,
      0,
      true,
    ],
    [
      'east',
      'H · 主室 東壁',
      b.mainWidth,
      b.eastDoorAt + b.eastDoorWidth,
      b.mainWidth,
      b.length - 2500,
      -1,
      0,
      true,
    ],
    ['east-north', 'I · 東壁 北側', b.mainWidth, 0, b.mainWidth, b.eastDoorAt, -1, 0, true],
    ['north', 'J · 北面ガラス', 0, 0, b.mainWidth, 0, 0, 1, false],
  ];
  const fixed = raw
    .filter((r) => Math.hypot(r[4] - r[2], r[5] - r[3]) > 0)
    .map(([id, name, x1, z1, x2, z2, nx, nz, hangable]) => {
      const length = Math.hypot(x2 - x1, z2 - z1);
      return {
        id,
        name,
        start: { x: x1, z: z1 },
        end: { x: x2, z: z2 },
        normal: { x: nx, z: nz },
        tangent: { x: (x2 - x1) / length, z: (z2 - z1) / length },
        length,
        hangable,
        height: b.height,
      };
    });
  return [...fixed, ...partitions.flatMap((p) => partitionFaces(p, rails))];
}
export { createRails } from './architecture.js';
export function railGeometry(r) {
  const length = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
  return { length, tangent: { x: (r.x2 - r.x1) / length, z: (r.z2 - r.z1) / length } };
}
export function partitionGeometry(p, rails) {
  const r = rails.find((r) => r.id === p.railId);
  if (!r) throw new Error('可動壁の配置ラインがありません');
  const { length, tangent } = railGeometry(r);
  return {
    x: r.x1 + tangent.x * p.s,
    z: r.z1 + tangent.z * p.s,
    tangent,
    normal: { x: tangent.z, z: -tangent.x },
    rotation: Math.atan2(-tangent.z, tangent.x),
    railLength: length,
  };
}
export function partitionFaces(p, rails) {
  const g = partitionGeometry(p, rails);
  return ['front', 'back'].map((face, i) => {
    const side = i === 0 ? 1 : -1,
      n = { x: g.normal.x * side, z: g.normal.z * side };
    return {
      id: `partition:${p.id}:${face}`,
      partitionId: p.id,
      face,
      name: `${p.name} · ${i === 0 ? '表面' : '裏面'}`,
      start: {
        x: g.x - (g.tangent.x * p.width) / 2 + (n.x * p.thickness) / 2,
        z: g.z - (g.tangent.z * p.width) / 2 + (n.z * p.thickness) / 2,
      },
      end: {
        x: g.x + (g.tangent.x * p.width) / 2 + (n.x * p.thickness) / 2,
        z: g.z + (g.tangent.z * p.width) / 2 + (n.z * p.thickness) / 2,
      },
      normal: n,
      tangent: g.tangent,
      length: p.width,
      height: p.height,
      hangable: true,
    };
  });
}
export function fitPartition(p, b, rails) {
  const g = partitionGeometry(p, rails);
  if (p.width > g.railLength || p.height > b.height)
    throw new Error('可動壁が配置ラインの長さ・天井高に収まりません');
  const min = Math.ceil(p.width / 2),
    max = Math.floor(g.railLength - p.width / 2);
  const next = { ...p, s: clamp(mm(p.s), min, max) };
  const ng = partitionGeometry(next, rails);
  for (const s of [-1, 1])
    for (const n of [-1, 1])
      if (
        !inFloor(
          ng.x + ((ng.tangent.x * p.width) / 2) * s + ((ng.normal.x * p.thickness) / 2) * n,
          ng.z + ((ng.tangent.z * p.width) / 2) * s + ((ng.normal.z * p.thickness) / 2) * n,
          b,
        )
      )
        throw new Error('可動壁の厚みを含めると建築の範囲外になります');
  return next;
}
export function inFloor(x, z, b) {
  return (
    (x >= 0 && x <= b.mainWidth && z >= 0 && z <= b.length) ||
    (x >= b.mainWidth - b.overallWidth &&
      x <= b.mainWidth &&
      z >= b.length - b.wingDepth &&
      z <= b.length)
  );
}
export function positionOnWall(w, s, bottom, art) {
  return {
    x: w.start.x + w.tangent.x * s + w.normal.x * (art.depth / 2 + 8),
    y: bottom + art.height / 2,
    z: w.start.z + w.tangent.z * s + w.normal.z * (art.depth / 2 + 8),
    rotation: Math.atan2(w.normal.x, w.normal.z),
  };
}
export function fitPlacement(p, art, b, partitions = [], rails = []) {
  const problem = placementProblem(art);
  if (problem) throw new Error(problem);
  const w = walls(b, partitions, rails).find((w) => w.id === p.wallId && w.hangable);
  if (!w) throw new Error('展示可能な壁面を選んでください');
  if (art.width > w.length || art.height > w.height)
    throw new Error('作品の実寸が壁面に収まりません');
  const minS = Math.ceil(art.width / 2),
    maxS = Math.floor(w.length - art.width / 2);
  if (minS > maxS) throw new Error('1 mm単位の中心座標では壁面に収まりません');
  return {
    ...p,
    s: clamp(mm(p.s), minS, maxS),
    bottom: clamp(mm(p.bottom), 0, w.height - art.height),
  };
}
export function layoutIssues(
  project,
  layout = project.layouts.find((l) => l.id === project.activeLayoutId),
) {
  const issues = [];
  for (const art of project.artworks) {
    const count = placedCount(art, layout.placements),
      limit = quantityLimit(art);
    if (count && (limit === null || count > limit))
      issues.push({
        id: layout.placements.find((p) => p.artworkId === art.id).id,
        message: `${art.title}：${count}点配置中 / 数量${limit ?? '未定'}。数量を確認するか配置を解除してください`,
      });
  }
  const ws = walls(project.building, layout.partitions, project.rails);
  for (const p of layout.placements) {
    const a = project.artworks.find((a) => a.id === p.artworkId),
      w = ws.find((w) => w.id === p.wallId);
    if (!a || !w) {
      issues.push({ id: p.id, message: '作品または壁面が見つかりません' });
      continue;
    }
    if (
      !w.hangable ||
      p.s - a.width / 2 < 0 ||
      p.s + a.width / 2 > w.length ||
      p.bottom < 0 ||
      p.bottom + a.height > w.height
    )
      issues.push({ id: p.id, message: `${a.title}：壁の範囲外` });
    for (const q of layout.placements) {
      if (q.id <= p.id || q.wallId !== p.wallId) continue;
      const other = project.artworks.find((a) => a.id === q.artworkId);
      if (
        other &&
        Math.abs(p.s - q.s) < (a.width + other.width) / 2 &&
        p.bottom < q.bottom + other.height &&
        q.bottom < p.bottom + a.height
      )
        issues.push({ id: p.id, message: `${a.title} と ${other.title} が重なっています` });
    }
  }
  const parts = layout.partitions || [],
    b = project.building;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i],
      g = partitionGeometry(p, project.rails);
    const hx = (Math.abs(g.tangent.x) * p.width) / 2 + (Math.abs(g.normal.x) * p.thickness) / 2,
      hz = (Math.abs(g.tangent.z) * p.width) / 2 + (Math.abs(g.normal.z) * p.thickness) / 2;
    if (
      Math.abs(g.x + b.columnSize / 2) < hx + b.columnSize / 2 &&
      Math.abs(g.z - (b.length - 4970 - b.columnSize / 2)) < hz + b.columnSize / 2
    )
      issues.push({ id: p.id, type: 'partition', message: `${p.name}：推定柱と干渉` });
    if (
      p.height > b.mezzanineHeight - 140 &&
      ((g.x - hx < 0 && g.z + hz > b.length - b.wingDepth && g.z - hz < b.length - 4970) ||
        (g.x + hx > 0 && g.z + hz > b.length - 4970 - 3650 && g.z - hz < b.length - 4970))
    )
      issues.push({ id: p.id, type: 'partition', message: `${p.name}：推定中二階と高さが干渉` });
    for (const q of parts.slice(i + 1)) {
      const o = partitionGeometry(q, project.rails);
      const qx = (Math.abs(o.tangent.x) * q.width) / 2 + (Math.abs(o.normal.x) * q.thickness) / 2,
        qz = (Math.abs(o.tangent.z) * q.width) / 2 + (Math.abs(o.normal.z) * q.thickness) / 2;
      if (Math.abs(g.x - o.x) < hx + qx && Math.abs(g.z - o.z) < hz + qz)
        issues.push({ id: p.id, type: 'partition', message: `${p.name} と ${q.name} が干渉` });
    }
  }
  return issues;
}
export function distribute(placements, artworks, ids, gap = null) {
  const ps = placements.filter((p) => ids.includes(p.id)).sort((a, b) => a.s - b.s);
  if (ps.length < 2) throw new Error('同じ壁の作品を2点以上選択してください');
  if (new Set(ps.map((p) => p.wallId)).size !== 1)
    throw new Error('等間隔配置は同じ壁面の作品を選択してください');
  const width = (p) => artworks.find((a) => a.id === p.artworkId).width;
  const start = ps[0].s - width(ps[0]) / 2;
  const end = ps.at(-1).s + width(ps.at(-1)) / 2;
  const spacing =
    gap === null ? (end - start - ps.reduce((n, p) => n + width(p), 0)) / (ps.length - 1) : gap;
  if (spacing < 0) throw new Error('作品が重なります。両端の距離を広げてください');
  let cursor = start;
  const result = new Map();
  for (const p of ps) {
    result.set(p.id, { ...p, s: mm(cursor + width(p) / 2) });
    cursor += width(p) + spacing;
  }
  return placements.map((p) => result.get(p.id) || p);
}
export function isWalkable(x, z, b, partitions = [], rails = [], radius = 220) {
  const west = b.mainWidth - b.overallWidth,
    junction = b.length - b.wingDepth;
  const inside =
    (x >= radius && x <= b.mainWidth - radius && z >= radius && z <= b.length - radius) ||
    (x >= west + radius &&
      x <= b.mainWidth - radius &&
      z >= junction + radius &&
      z <= b.length - radius);
  if (!inside) return false;
  const cx = -b.columnSize / 2,
    cz = b.length - 4970 - b.columnSize / 2;
  if (Math.abs(x - cx) < b.columnSize / 2 + radius && Math.abs(z - cz) < b.columnSize / 2 + radius)
    return false;
  return partitions.every((p) => {
    const g = partitionGeometry(p, rails),
      dx = x - g.x,
      dz = z - g.z;
    return (
      Math.abs(dx * g.tangent.x + dz * g.tangent.z) >= p.width / 2 + radius ||
      Math.abs(dx * g.normal.x + dz * g.normal.z) >= p.thickness / 2 + radius
    );
  });
}
const svgImage = (kind) => {
  const colors = ['#b9653d', '#334840', '#c8aa7b', '#405b70'];
  const c = colors[kind % 4];
  return (
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100"><rect width="900" height="1100" fill="#ebe5d8"/><rect x="70" y="70" width="760" height="960" fill="${c}"/>${kind % 2 === 0 ? '<circle cx="450" cy="440" r="245" fill="#ded4bc"/><path d="M70 700h760v330H70z" fill="#262d29"/><path d="M70 680Q450 450 830 750v280H70z" fill="#aeb0a0"/>' : '<path d="M150 150h300v800H150z" fill="#d1c2a5"/><path d="M450 150h300v400H450z" fill="#283a35"/><circle cx="600" cy="760" r="150" fill="#c7774b"/>'}</svg>`,
    )
  );
};
export function createProject() {
  const artworks = [
    {
      id: 'art-1',
      title: '静かな地平 / サンプル',
      artist: 'MA study 01',
      width: 900,
      height: 1100,
      depth: 35,
      image: svgImage(0),
    },
    {
      id: 'art-2',
      title: 'かたちの対話 / サンプル',
      artist: 'MA study 02',
      width: 700,
      height: 900,
      depth: 30,
      image: svgImage(1),
    },
    {
      id: 'art-3',
      title: '光の余白 / サンプル',
      artist: 'MA study 03',
      width: 1200,
      height: 1000,
      depth: 40,
      image: svgImage(2),
    },
    {
      id: 'art-4',
      title: '青の断片 / サンプル',
      artist: 'MA study 04',
      width: 600,
      height: 800,
      depth: 30,
      image: svgImage(3),
    },
  ];
  for (const art of artworks) art.quantity = 1;
  return addSuppliedArtworks({
    schemaVersion: SCHEMA_VERSION,
    name: '余白をめぐる展覧会',
    building: { ...DEFAULT_BUILDING },
    rails: createRails(DEFAULT_BUILDING),
    artworks,
    artworkLabels: structuredClone(DEFAULT_LABELS),
    frameShapes: [],
    steelSections: [],
    layouts: [
      {
        id: 'layout-1',
        name: 'プラン A',
        lighting: lightingDefaults(),
        partitions: [],
        steelFrames: [],
        steelLineMembranes: [],
        placements: [
          { id: 'p-1', artworkId: 'art-1', wallId: 'west', s: 6000, bottom: 950 },
          { id: 'p-2', artworkId: 'art-2', wallId: 'west', s: 8500, bottom: 1050 },
          { id: 'p-3', artworkId: 'art-3', wallId: 'west', s: 11200, bottom: 1000 },
          { id: 'p-4', artworkId: 'art-4', wallId: 'east', s: 12000, bottom: 1100 },
        ],
      },
    ],
    activeLayoutId: 'layout-1',
  });
}
export function validateProject(d) {
  if (!d || d.schemaVersion !== SCHEMA_VERSION || typeof d.name !== 'string' || d.name.length > 200)
    throw new Error('対応するMAプロジェクト形式ではありません（schemaVersion: 1）');
  d.artworkLabels ??= structuredClone(DEFAULT_LABELS);
  if (
    typeof d.artworkLabels.enabled !== 'boolean' ||
    !Array.isArray(d.artworkLabels.fields) ||
    d.artworkLabels.fields.length > LABEL_FIELDS.length ||
    !d.artworkLabels.fields.every((key) => LABEL_FIELDS.some(([id]) => id === key)) ||
    new Set(d.artworkLabels.fields).size !== d.artworkLabels.fields.length
  )
    throw new Error('作品情報の表示設定が不正です');
  const bounds = {
    mainWidth: [2000, 50000],
    overallWidth: [3000, 100000],
    length: [10000, 150000],
    wingDepth: [3000, 50000],
    height: [2200, 20000],
    wallThickness: [50, 1000],
    beamDepth: [100, 2000],
    beamWidth: [100, 1500],
    beamPitch: [1000, 10000],
    mezzanineHeight: [2200, 10000],
    columnSize: [300, 2000],
    sideDoorAt: [1000, 100000],
    sideDoorWidth: [700, 5000],
    eastDoorAt: [1000, 100000],
    eastDoorWidth: [700, 5000],
  };
  if (!d.building) throw new Error('建築データがありません');
  for (const [k, [min, max]] of Object.entries(bounds))
    if (!Number.isInteger(d.building[k]) || d.building[k] < min || d.building[k] > max)
      throw new Error(`建築寸法が不正です：${k} (${min}〜${max} mm)`);
  const b = d.building;
  if (
    b.overallWidth <= b.mainWidth ||
    b.wingDepth >= b.length ||
    b.sideDoorAt + b.sideDoorWidth >= b.length - b.wingDepth ||
    b.eastDoorAt + b.eastDoorWidth >= b.length - 2500 ||
    b.mezzanineHeight >= b.height
  )
    throw new Error('建築寸法の相互関係が成立しません。全長・扉・西室の位置を確認してください');
  if (
    !Array.isArray(d.artworks) ||
    d.artworks.length > 500 ||
    !Array.isArray(d.layouts) ||
    !d.layouts.length ||
    d.layouts.length > 100
  )
    throw new Error('作品・レイアウト一覧が不正です');
  d.rails ??= createRails(b);
  if (!Array.isArray(d.rails) || d.rails.length > 100)
    throw new Error('可動壁の配置ラインが不正です');
  for (const r of d.rails)
    if (
      typeof r.id !== 'string' ||
      typeof r.name !== 'string' ||
      r.name.length > 200 ||
      ![r.x1, r.z1, r.x2, r.z2].every(Number.isInteger) ||
      (r.x1 !== r.x2 && r.z1 !== r.z2) ||
      railGeometry(r).length < 1000 ||
      !inFloor(r.x1, r.z1, b) ||
      !inFloor(r.x2, r.z2, b)
    )
      throw new Error('配置ラインは建物内の水平・垂直線で1,000 mm以上にしてください');
  const unique = (xs) => new Set(xs.map((x) => x.id)).size === xs.length;
  if (!unique(d.artworks) || !unique(d.layouts) || !unique(d.rails))
    throw new Error('IDが重複しています');
  if (
    d.appliedCatalogs !== undefined &&
    (!Array.isArray(d.appliedCatalogs) ||
      d.appliedCatalogs.length > 100 ||
      !d.appliedCatalogs.every((id) => typeof id === 'string' && id.length <= 100))
  )
    throw new Error('作品リストの追加履歴が不正です');
  for (const a of d.artworks) {
    if (a.quantity === undefined) a.quantity = 1;
    if (
      typeof a.id !== 'string' ||
      typeof a.title !== 'string' ||
      a.title.length > 300 ||
      typeof a.artist !== 'string' ||
      a.artist.length > 300 ||
      ![a.width, a.height].every(
        (n) => n === null || (Number.isInteger(n) && n > 0 && n <= 30000),
      ) ||
      !Number.isInteger(a.depth) ||
      a.depth <= 0 ||
      a.depth > 30000 ||
      typeof a.image !== 'string' ||
      a.image.length > 12000000 ||
      (a.image !== '' && !/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(a.image))
    )
      throw new Error('作品データまたは画像形式が不正です');
    validateArtworkMetadata(a);
    // SVG is generated only for built-in samples; prevent active SVG in imported files.
    if (
      a.image.startsWith('data:image/svg') &&
      a.image !== svgImage(0) &&
      a.image !== svgImage(1) &&
      a.image !== svgImage(2) &&
      a.image !== svgImage(3)
    )
      throw new Error('外部SVGは取り込めません。PNG/JPEG/WebPに変換してください');
  }
  for (const l of d.layouts) {
    l.lighting ??= lightingDefaults();
    validateLighting(l.lighting);
    if (
      typeof l.id !== 'string' ||
      typeof l.name !== 'string' ||
      l.name.length > 200 ||
      !Array.isArray(l.placements) ||
      l.placements.length > 2000 ||
      !unique(l.placements)
    )
      throw new Error('レイアウトが不正です');
    l.partitions ??= [];
    if (!Array.isArray(l.partitions) || l.partitions.length > 200 || !unique(l.partitions))
      throw new Error('可動壁データが不正です');
    for (const p of l.partitions) {
      if (
        typeof p.id !== 'string' ||
        typeof p.name !== 'string' ||
        p.name.length > 200 ||
        ![p.width, p.height, p.thickness, p.s].every(Number.isInteger) ||
        p.width < 100 ||
        p.width > 30000 ||
        p.height < 100 ||
        p.height > 20000 ||
        p.thickness < 10 ||
        p.thickness > 2000
      )
        throw new Error('可動壁寸法が不正です');
      const fitted = fitPartition(p, b, d.rails);
      if (fitted.s !== p.s) throw new Error('可動壁が配置ラインの範囲外です');
    }
    for (const p of l.placements)
      if (
        typeof p.id !== 'string' ||
        !d.artworks.some((a) => a.id === p.artworkId && !placementProblem(a)) ||
        !walls(b, l.partitions, d.rails).some((w) => w.id === p.wallId && w.hangable) ||
        !Number.isInteger(p.s) ||
        !Number.isInteger(p.bottom) ||
        Math.abs(p.s) > 1000000 ||
        Math.abs(p.bottom) > 100000
      )
        throw new Error('配置データが不正です');
  }
  validateSteelProject(d);
  validateSteelLineMembranes(d);
  if (!d.layouts.some((l) => l.id === d.activeLayoutId))
    throw new Error('選択中のレイアウトがありません');
  return d;
}
