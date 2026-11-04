// Artwork and packing dimensions use mm. Legacy input is retained only as a
// migration baseline; the active catalog contains interpreted numeric data.
export const SUPPLIED_CATALOG = 'kcua-2026-11-04';
export const INTERPRETED_CATALOG = `${SUPPLIED_CATALOG}-interpreted-v2`;
export const DIMENSION_STATUSES = {
  supplied: '指定寸法',
  approximate: '概寸',
  provisional: '仮寸法',
  unknown: '未確定',
};
export const DISPLAY_METHODS = {
  wall: '壁面',
  table: '机上・平置き',
  freestanding: '自立',
  undecided: '未定',
};
export const CATALOG_FIELDS = {
  year: ['制作年', 100],
  attribute: ['属性', 200],
  sizeText: ['作品サイズ補足', 500],
  sizeNumber: ['作品サイズ（号）・形式', 100],
  exhibitionStatus: ['出展区分', 100],
  arrangement: ['展示構成', 500],
  interpretation: ['寸法・数量の解釈', 1000],
  packingGroup: ['共通梱包グループ', 200],
  notes: ['備考', 3000],
};

const supplied = [
  [
    'goda-new',
    '合田',
    '出す作品　新作',
    '2026',
    '275×120',
    '',
    '135×90が2枚、135×30が2枚',
    '新作',
    2750,
    1200,
    1,
    'wall',
  ],
  [
    'goda-scroll',
    '合田',
    '出す作品　片方新作『花卉蔬菜図巻』',
    '2026',
    '200×30(2点)',
    '巻物',
    '30×10',
    '片方新作(長い机上のものにベタ置き？)',
    2000,
    300,
    2,
    'undecided',
  ],
  [
    'goda-flowers',
    '合田',
    '花の連作5点',
    '2024-2025',
    '6～8号(5点)',
    '',
    '',
    '出したい',
    null,
    null,
    5,
    'wall',
  ],
  [
    'goda-gibbon',
    '合田',
    '出せるなら(テナガザル)',
    '2023',
    '158×158',
    '',
    '158×79が2枚',
    '出せるなら出したい',
    1580,
    1580,
    1,
    'wall',
  ],
  [
    'goda-crane',
    '合田',
    '出せるなら(鶴)',
    '2024',
    '151×130',
    '',
    '151×75以内が2枚',
    '加筆予定、出せるなら出したい',
    1510,
    1300,
    1,
    'wall',
  ],
  [
    'goda-solstice',
    '合田',
    '出せるなら(summer solstice)',
    '2025',
    '220×170',
    '',
    '170×70が3枚',
    '時間あれば加筆したい、出せるなら出したい',
    2200,
    1700,
    1,
    'wall',
  ],
  [
    'matsudaira-new',
    '松平',
    '出す作品',
    '2026',
    '270*180',
    '',
    '90×180×35程度 3つ',
    '新作',
    2700,
    1800,
    1,
    'wall',
  ],
  ['mitsuhashi-new', '三橋', '出す作品', '2026', '500*182', '', '', '新作', 5000, 1820, 1, 'wall'],
  [
    'mitsuhashi-series',
    '三橋',
    '出す作品たち',
    '2024-2026',
    '色々（0号程度から20号程度）',
    '',
    '',
    '40枚くらいある。ペラペラ',
    null,
    null,
    40,
    'wall',
  ],
  [
    'hattori-ox',
    '服部',
    '十牛図',
    '2025-2026',
    '93×93（額含む）',
    '30S',
    '',
    '全10枚',
    930,
    930,
    10,
    'wall',
  ],
  [
    'hattori-screen',
    '服部',
    '四曲屏風',
    '2026',
    '348×178',
    '四曲屏風',
    '90×180',
    '屏風のため、自立する',
    3480,
    1780,
    1,
    'freestanding',
  ],
  [
    'uesaka-new',
    '上坂',
    '出す作品　新作',
    '2026',
    '160×118（6枚）',
    '',
    '165×125×35程度',
    '横に３枚、上下２段にする',
    1600,
    1180,
    6,
    'wall',
  ],
  [
    'uesaka-recent',
    '上坂',
    '出す作品準新作',
    '2026',
    '160×118（3枚）',
    '',
    '165×125×18程度',
    '壁で展示',
    1600,
    1180,
    3,
    'wall',
  ],
  [
    'uesaka-small',
    '上坂',
    '小さいもの',
    '2025-2026',
    '20×30、30×40、40×50 程度',
    '',
    '60×60×60程度',
    '展示会場に点在したい',
    null,
    null,
    null,
    'wall',
  ],
];

export function legacySuppliedArtworks() {
  return supplied.map(
    ([
      id,
      artist,
      title,
      year,
      sizeText,
      sizeNumber,
      packingSize,
      notes,
      width,
      height,
      quantity,
      displayMethod,
    ]) => ({
      id: `${SUPPLIED_CATALOG}-${id}`,
      artist,
      title,
      year,
      attribute: '@KCUA',
      sizeText,
      sizeNumber,
      packingSize,
      notes,
      width,
      height,
      depth: 40,
      quantity,
      displayMethod,
      image: '',
    }),
  );
}

const packing = (
  width,
  height,
  depth = null,
  quantity = null,
  approximate = false,
  upperBound = false,
) => ({ width, height, depth, quantity, approximate, upperBound });

export function suppliedArtworks() {
  const arts = legacySuppliedArtworks();
  const details = [
    {
      packages: [packing(1350, 900, null, 2), packing(1350, 300, null, 2)],
      exhibitionStatus: '出展予定',
      notes: '新作。',
    },
    {
      packages: [packing(300, 100)],
      displayMethod: 'table',
      exhibitionStatus: '出展予定',
      arrangement: '長机に2点を平置き（案）',
      notes: '2点のうち1点が新作。',
      interpretation: '1点あたり幅2000×高さ300mm。机上展示は提案段階。',
    },
    {
      width: 455,
      height: 380,
      sizeNumber: '6〜8号（号種未確認）',
      dimensionStatus: 'provisional',
      exhibitionStatus: '出展希望',
      notes: '5点の連作。',
      interpretation:
        '各点の号数・F/P/M/S・縦横方向が未指定のため、5点ともF8横455×380mmを配置用の仮寸法に採用。実測寸法ではない。',
    },
    {
      packages: [packing(1580, 790, null, 2)],
      exhibitionStatus: '出展候補',
      notes: '出展可能であれば展示。',
    },
    {
      packages: [packing(1510, 750, null, 2, false, true)],
      exhibitionStatus: '出展候補',
      notes: '加筆予定。出展可能であれば展示。',
    },
    {
      packages: [packing(1700, 700, null, 3)],
      exhibitionStatus: '出展候補',
      notes: '時間があれば加筆。出展可能であれば展示。',
    },
    { packages: [packing(900, 1800, 350, 3, true)], exhibitionStatus: '出展予定', notes: '新作。' },
    { exhibitionStatus: '出展予定', notes: '新作。' },
    {}, // The user explicitly requested that Mitsuhashi's mixed group stay unchanged.
    { exhibitionStatus: '出展予定', arrangement: '10枚組・壁面展示', notes: '額を含む外寸。' },
    {
      packages: [packing(900, 1800)],
      exhibitionStatus: '出展予定',
      arrangement: '4面の自立式屏風',
      notes: '開いた状態の全幅3480mm。1面あたりの幅は870mm。',
      interpretation:
        '作品1点を構成する屏風4面。点数は4点ではなく1点。設置時の幅は開き角で変わる。',
    },
    {
      packages: [packing(1650, 1250, 350, null, true)],
      exhibitionStatus: '出展予定',
      arrangement: '3列×2段（6枚）',
      assemblyColumns: 3,
      assemblyRows: 2,
      notes: '新作。6枚を壁面に展示。',
      interpretation: '1枚1600×1180mm。間隔を含めない全体寸法は幅4800×高さ2360mm。梱包数は未指定。',
    },
    {
      packages: [packing(1650, 1250, 180, null, true)],
      exhibitionStatus: '出展予定',
      arrangement: '3枚・壁面展示',
      notes: '準新作。3枚の配列は未指定。',
    },
    {
      packages: [packing(600, 600, 600, null, true)],
      packingGroup: '上坂・小品共通',
      exhibitionStatus: '出展希望',
      dimensionStatus: 'approximate',
      notes: '会場内に分散展示。各サイズの点数は未定。',
      interpretation: '3種類のサイズを別項目に分けて管理。梱包寸法は小品群共通で、梱包数は未指定。',
    },
  ];
  return arts.flatMap((art, i) => {
    if (i === 8) return [art];
    const { packingSize, ...base } = art;
    const interpreted = {
      ...base,
      sizeText: '',
      packages: [],
      dimensionStatus: 'supplied',
      ...details[i],
    };
    if (i !== 13) return [interpreted];
    return [
      [200, 300],
      [300, 400],
      [400, 500],
    ].map(([width, height], variant) => ({
      ...interpreted,
      id: variant ? `${base.id}-${width}x${height}` : base.id,
      title: `小さいもの（${width / 10}×${height / 10}cm）`,
      width,
      height,
      quantity: null,
    }));
  });
}

// Upgrade only unchanged seed fields. Keep manual edits, placements, and user
// deletions; apply the two extra small-work sizes only if that group still exists.
export function addSuppliedArtworks(project) {
  if (project.appliedCatalogs?.includes(INTERPRETED_CATALOG)) return project;
  const defaults = suppliedArtworks();
  const previouslyAdded = project.appliedCatalogs?.includes(SUPPLIED_CATALOG);
  const oldDefaults = new Map(legacySuppliedArtworks().map((art) => [art.id, art]));
  const newDefaults = new Map(defaults.map((art) => [art.id, art]));
  const placedIds = new Set(
    (project.layouts || []).flatMap((layout) => layout.placements.map((p) => p.artworkId)),
  );
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const upgraded = project.artworks.map((art) => {
    const before = oldDefaults.get(art.id),
      after = newDefaults.get(art.id);
    if (!before || !after) return art;
    const next = { ...art };
    const manualDimensions = !equal(art.width, before.width) || !equal(art.height, before.height);
    const manualPacking =
      art.packingSize !== undefined && !equal(art.packingSize, before.packingSize);
    const manualQuantity = !equal(art.quantity, before.quantity);
    const keepWallPlacement =
      placedIds.has(art.id) && ['table', 'freestanding'].includes(after.displayMethod);
    for (const [key, value] of Object.entries(after))
      if (
        !(manualPacking && key === 'packages') &&
        !(manualDimensions && ['dimensionStatus', 'interpretation'].includes(key)) &&
        !(
          manualQuantity &&
          ['assemblyColumns', 'assemblyRows', 'arrangement', 'interpretation', 'notes'].includes(
            key,
          )
        ) &&
        !(keepWallPlacement && key === 'displayMethod') &&
        (next[key] === undefined || equal(next[key], before[key]))
      )
        next[key] = structuredClone(value);
    if (manualDimensions) next.dimensionStatus ??= 'supplied';
    if (keepWallPlacement && art.interpretation === undefined)
      next.interpretation = `${next.interpretation || ''}既存の壁面配置を保つため、展示方法の変更は保留。`;
    if (after.packingSize === undefined && equal(next.packingSize, before.packingSize))
      delete next.packingSize;
    return next;
  });
  const smallGroupExists = project.artworks.some(
    (a) => a.id === `${SUPPLIED_CATALOG}-uesaka-small`,
  );
  const missing = defaults.filter(
    (art) =>
      !upgraded.some((a) => a.id === art.id) &&
      (!previouslyAdded ||
        (smallGroupExists && art.id.startsWith(`${SUPPLIED_CATALOG}-uesaka-small-`))),
  );
  if (upgraded.length + missing.length > 500)
    throw new Error('作品数の上限500件を超えるため、提供作品リストを追加できません');
  project.artworks = [...upgraded, ...missing];
  project.appliedCatalogs = [
    ...new Set([...(project.appliedCatalogs || []), SUPPLIED_CATALOG, INTERPRETED_CATALOG]),
  ];
  return project;
}

export const hasDimensions = (art) =>
  Number.isInteger(art.width) && art.width > 0 && Number.isInteger(art.height) && art.height > 0;
// A missing legacy quantity means a unique work; null explicitly means undecided.
export const quantityLimit = (art) => (art.quantity === undefined ? 1 : art.quantity);
export const placedCount = (art, placements) =>
  placements.filter((p) => p.artworkId === art.id).length;
export function inventoryProblem(art, placements) {
  const limit = quantityLimit(art),
    count = placedCount(art, placements);
  if (limit === null) return '数量（配置上限）を入力してから追加してください';
  return count >= limit ? `数量上限です（${count} / ${limit}点配置中）` : '';
}
export function placementProblem(art) {
  if (!hasDimensions(art)) return '幅・高さの実寸を入力してから配置してください';
  if (art.displayMethod === 'table' || art.displayMethod === 'freestanding')
    return '机上・自立作品は一覧で管理できます。現在の配置機能は壁面展示に対応しています';
  return '';
}

export function validateArtworkMetadata(art) {
  for (const [key, [label, max]] of Object.entries(CATALOG_FIELDS)) {
    if (art[key] !== undefined && (typeof art[key] !== 'string' || art[key].length > max))
      throw new Error(`${label}が不正です（${max}文字以内）`);
  }
  if (
    art.quantity !== undefined &&
    art.quantity !== null &&
    (!Number.isInteger(art.quantity) || art.quantity < 1 || art.quantity > 10000)
  )
    throw new Error('数量は1〜10,000の整数、または未入力にしてください');
  if (art.displayMethod !== undefined && !Object.hasOwn(DISPLAY_METHODS, art.displayMethod))
    throw new Error('展示方法が不正です');
  if (art.dimensionStatus !== undefined && !Object.hasOwn(DIMENSION_STATUSES, art.dimensionStatus))
    throw new Error('寸法の確度が不正です');
  if (
    art.packingSize !== undefined &&
    (typeof art.packingSize !== 'string' || art.packingSize.length > 500)
  )
    throw new Error('梱包メモが不正です');
  for (const key of ['assemblyColumns', 'assemblyRows'])
    if (
      art[key] !== undefined &&
      art[key] !== null &&
      (!Number.isInteger(art[key]) || art[key] < 1 || art[key] > 100)
    )
      throw new Error('展示構成の列数・段数は1〜100の整数にしてください');
  if (
    art.assemblyColumns &&
    art.assemblyRows &&
    art.quantity &&
    art.assemblyColumns * art.assemblyRows !== art.quantity
  )
    throw new Error('展示構成の列数×段数を作品の点数に合わせてください');
  if (art.packages !== undefined) {
    if (!Array.isArray(art.packages) || art.packages.length > 100)
      throw new Error('梱包一覧が不正です');
    for (const pack of art.packages) {
      if (
        !pack ||
        ![pack.width, pack.height, pack.depth].every(
          (n) => n === null || (Number.isInteger(n) && n > 0 && n <= 100000),
        ) ||
        (pack.quantity !== null &&
          (!Number.isInteger(pack.quantity) || pack.quantity < 1 || pack.quantity > 10000)) ||
        typeof pack.approximate !== 'boolean' ||
        typeof pack.upperBound !== 'boolean'
      )
        throw new Error('梱包の寸法・数量が不正です');
    }
  }
}

export function packingSummary(art) {
  if (!art.packages?.length) return art.packingSize || '';
  return (
    art.packages
      .map(
        (pack) =>
          `${[pack.width, pack.height, pack.depth].map((n) => n ?? '未定').join('×')} mm${pack.upperBound ? '以内' : ''}${pack.approximate ? '（概寸）' : ''} / ${pack.quantity ?? '数量未定'}${pack.quantity ? '梱包' : ''}`,
      )
      .join('、') + (art.packingGroup ? `［共通：${art.packingGroup}］` : '')
  );
}

export function assemblySummary(art) {
  if (art.assemblyColumns && art.assemblyRows && hasDimensions(art))
    return `${art.assemblyColumns}列×${art.assemblyRows}段 / 間隔なし ${art.width * art.assemblyColumns}×${art.height * art.assemblyRows} mm`;
  return art.arrangement || '';
}

export const CATALOG_COLUMNS = [
  ['artist', '作家'],
  ['title', '作品名'],
  ['year', '制作年'],
  ['attribute', '属性'],
  ['dimensions', '作品サイズ 幅×高さ×厚み（mm）'],
  ['sizeNumber', '作品サイズ（号）・形式'],
  ['quantity', '数量（配置上限）'],
  ['width', '幅（mm・1点あたり）'],
  ['height', '高さ（mm・1点あたり）'],
  ['depth', '厚み（mm）'],
  ['dimensionStatus', '寸法の確度'],
  ['packages', '梱包（幅×高さ×奥行mm・数量）'],
  ['arrangement', '展示構成'],
  ['exhibitionStatus', '出展区分'],
  ['displayMethod', '展示方法'],
  ['notes', '備考'],
  ['interpretation', '寸法・数量の解釈'],
];
export const catalogValue = (art, key) => {
  if (key === 'quantity') return quantityLimit(art) ?? '';
  if (key === 'dimensions') {
    if (!hasDimensions(art)) return art.sizeText || '未確定';
    const qualifier =
      art.dimensionStatus && art.dimensionStatus !== 'supplied'
        ? `（${DIMENSION_STATUSES[art.dimensionStatus]}）`
        : '';
    return `${art.width}×${art.height}×${art.depth}${qualifier}${art.sizeText ? ` / ${art.sizeText}` : ''}`;
  }
  if (key === 'displayMethod') return DISPLAY_METHODS[art.displayMethod] || '未定';
  if (key === 'dimensionStatus') return DIMENSION_STATUSES[art.dimensionStatus] || '';
  if (key === 'packages') return packingSummary(art);
  if (key === 'arrangement') return assemblySummary(art);
  return art[key] ?? '';
};

export function catalogCSV(artworks) {
  const quote = (value) => {
    const s = String(value);
    // Preserve literal text in spreadsheet apps, including the @KCUA attribute.
    return '"' + (/^[\s\uFEFF]*[=+\-@]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      CATALOG_COLUMNS.map(([, label]) => label),
      ...artworks.map((art) => CATALOG_COLUMNS.map(([key]) => catalogValue(art, key))),
    ]
      .map((row) => row.map(quote).join(','))
      .join('\r\n')
  );
}

export function catalogJSON(artworks) {
  return JSON.stringify({ format: 'ma-artwork-catalog', version: 1, artworks }, null, 2);
}

// Validate against the existing project's artwork and image validation too.
// ID collisions are intentional updates; layouts and unrelated works stay intact.
export function mergeCatalog(project, data, validateProject) {
  if (
    data?.format !== 'ma-artwork-catalog' ||
    data.version !== 1 ||
    !Array.isArray(data.artworks) ||
    data.artworks.length > 500
  )
    throw new Error('対応する作品リストJSONではありません');
  if (new Set(data.artworks.map((a) => a?.id)).size !== data.artworks.length)
    throw new Error('作品リスト内でIDが重複しています');
  const next = structuredClone(project);
  for (const art of data.artworks) {
    const i = next.artworks.findIndex((a) => a.id === art?.id);
    if (i < 0) next.artworks.push(art);
    else next.artworks[i] = art;
  }
  return validateProject(next);
}
