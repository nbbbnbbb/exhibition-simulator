import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, fitPlacement } from '../src/domain.js';
import {
  suppliedArtworks,
  addSuppliedArtworks,
  placementProblem,
  catalogCSV,
  catalogJSON,
  mergeCatalog,
  legacySuppliedArtworks,
  SUPPLIED_CATALOG,
  INTERPRETED_CATALOG,
  packingSummary,
  assemblySummary,
  catalogValue,
} from '../src/catalog.js';

test('元の14行を解釈して16項目に整理し、三橋の混在作品群だけ元のまま保持する', () => {
  const arts = suppliedArtworks();
  assert.equal(arts.length, 16);
  assert.deepEqual(
    arts.map((a) => [a.artist, a.width, a.height, a.quantity]),
    [
      ['合田', 2750, 1200, 1],
      ['合田', 2000, 300, 2],
      ['合田', 455, 380, 5],
      ['合田', 1580, 1580, 1],
      ['合田', 1510, 1300, 1],
      ['合田', 2200, 1700, 1],
      ['松平', 2700, 1800, 1],
      ['三橋', 5000, 1820, 1],
      ['三橋', null, null, 40],
      ['服部', 930, 930, 10],
      ['服部', 3480, 1780, 1],
      ['上坂', 1600, 1180, 6],
      ['上坂', 1600, 1180, 3],
      ['上坂', 200, 300, null],
      ['上坂', 300, 400, null],
      ['上坂', 400, 500, null],
    ],
  );
  assert.ok(arts.every((a) => a.depth === 40 && a.attribute === '@KCUA' && a.image === ''));
  assert.equal(arts[1].sizeNumber, '巻物');
  assert.equal(arts[1].packages[0].width, 300);
  assert.equal(arts[1].packages[0].height, 100);
  assert.equal(arts[1].displayMethod, 'table');
  assert.equal(arts[2].dimensionStatus, 'provisional');
  assert.equal(catalogValue(arts[2], 'dimensions'), '455×380×40（仮寸法）');
  assert.equal(catalogValue(arts[8], 'dimensions'), '色々（0号程度から20号程度）');
  assert.equal(arts[2].sizeText, '');
  assert.match(arts[2].interpretation, /F8横455×380mm/);
  assert.equal(arts[8].notes, '40枚くらいある。ペラペラ');
  assert.equal(arts[9].sizeNumber, '30S');
  assert.equal(arts[10].displayMethod, 'freestanding');
  assert.equal(arts[11].assemblyColumns, 3);
  assert.equal(arts[11].assemblyRows, 2);
  assert.match(assemblySummary(arts[11]), /4800×2360 mm/);
  assert.deepEqual(arts[8], legacySuppliedArtworks()[8]);
  assert.ok(arts.filter((_, i) => i !== 8).every((a) => a.width && a.height && !a.sizeText));
  assert.ok(
    arts
      .slice(13)
      .every((a) => a.dimensionStatus === 'approximate' && a.packingGroup === '上坂・小品共通'),
  );
  assert.deepEqual(
    arts[0].packages.map((p) => [p.width, p.height, p.quantity]),
    [
      [1350, 900, 2],
      [1350, 300, 2],
    ],
  );
  assert.equal(arts[4].packages[0].upperBound, true);
  assert.match(packingSummary(arts[4]), /1510×750×未定 mm以内 \/ 2梱包/);
  assert.deepEqual(arts[6].packages[0], {
    width: 900,
    height: 1800,
    depth: 350,
    quantity: 3,
    approximate: true,
    upperBound: false,
  });
});

test('旧保存データに一度だけ追加し、ユーザーの編集・配置・削除を維持する', () => {
  const project = createProject();
  project.artworks = project.artworks.slice(0, 4);
  delete project.appliedCatalogs;
  const before = structuredClone(project);
  addSuppliedArtworks(project);
  assert.equal(project.artworks.length, 20);
  assert.deepEqual(project.artworks.slice(0, 4), before.artworks);
  assert.deepEqual(project.layouts, before.layouts);
  project.artworks[4].notes = '編集済み';
  project.artworks.splice(5, 1);
  const edited = structuredClone(project);
  assert.deepEqual(addSuppliedArtworks(project), edited);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), edited);
  // Recover an interrupted migration without duplicating or overwriting entries.
  delete project.appliedCatalogs;
  addSuppliedArtworks(project);
  assert.equal(project.artworks.length, 20);
  assert.equal(project.artworks[4].notes, '編集済み');
});

test('前回追加済みの14行にも解釈結果を反映し、手入力・既存配置・削除を保護する', () => {
  const project = createProject();
  project.artworks = [...project.artworks.slice(0, 4), ...legacySuppliedArtworks()];
  project.appliedCatalogs = [SUPPLIED_CATALOG];
  project.artworks[4].notes = 'ユーザー追記';
  project.artworks[5].packingSize = '専用ケースへ変更';
  project.artworks[6].width = 410;
  project.artworks[6].height = 318;
  project.artworks[15].quantity = 4;
  project.layouts[0].placements.push({
    id: 'existing-scroll',
    artworkId: project.artworks[5].id,
    wallId: 'west',
    s: 18000,
    bottom: 1000,
  });
  project.artworks = project.artworks.filter((a) => !a.id.endsWith('-goda-crane'));
  const layouts = structuredClone(project.layouts);
  addSuppliedArtworks(project);
  assert.equal(project.artworks.length, 19);
  assert.equal(project.artworks.find((a) => a.id.endsWith('-goda-new')).notes, 'ユーザー追記');
  const scroll = project.artworks.find((a) => a.id.endsWith('-goda-scroll'));
  assert.equal(scroll.packingSize, '専用ケースへ変更');
  assert.equal(scroll.packages, undefined);
  assert.equal(scroll.displayMethod, 'undecided');
  assert.match(scroll.interpretation, /既存の壁面配置/);
  const uesaka = project.artworks.find((a) => a.id.endsWith('-uesaka-new'));
  assert.equal(uesaka.quantity, 4);
  assert.equal(uesaka.assemblyColumns, undefined);
  const flowers = project.artworks.find((a) => a.id.endsWith('-goda-flowers'));
  assert.equal(flowers.width, 410);
  assert.equal(flowers.height, 318);
  assert.equal(flowers.dimensionStatus, 'supplied');
  assert.equal(flowers.interpretation, undefined);
  assert.deepEqual(project.layouts, layouts);
  assert.deepEqual(
    project.artworks.find((a) => a.id.endsWith('-mitsuhashi-series')),
    legacySuppliedArtworks()[8],
  );
  assert.ok(project.appliedCatalogs.includes(INTERPRETED_CATALOG));
  const copy = structuredClone(project);
  assert.deepEqual(addSuppliedArtworks(project), copy);
  validateProject(project);
  const deletedSmall = createProject();
  deletedSmall.artworks = [
    ...deletedSmall.artworks.slice(0, 4),
    ...legacySuppliedArtworks().filter((a) => !a.id.endsWith('-uesaka-small')),
  ];
  deletedSmall.appliedCatalogs = [SUPPLIED_CATALOG];
  addSuppliedArtworks(deletedSmall);
  assert.equal(
    deletedSmall.artworks.some((a) => a.id.includes('-uesaka-small')),
    false,
  );
});

test('画像なしの実寸作品は配置でき、実寸不明・自立作品は一覧で管理する', () => {
  const project = createProject(),
    arts = suppliedArtworks();
  assert.equal(placementProblem(arts[0]), '');
  assert.equal(
    fitPlacement({ wallId: 'west', s: 6000, bottom: 0 }, arts[0], project.building).s,
    6000,
  );
  for (const index of [1, 8, 10]) {
    assert.ok(placementProblem(arts[index]));
    assert.throws(() =>
      fitPlacement({ wallId: 'west', s: 6000, bottom: 0 }, arts[index], project.building),
    );
  }
  const invalid = structuredClone(project);
  invalid.layouts[0].placements[0].artworkId = arts[8].id;
  assert.throws(() => validateProject(invalid), /配置データ/);
});

test('作品リストJSONを追加入力・復元してもプランと他の作品を保つ', () => {
  const project = createProject();
  const art = { ...project.artworks[4], notes: '改行\n"引用", 梱包を変更' };
  const data = JSON.parse(catalogJSON([art]));
  const merged = mergeCatalog(project, data, validateProject);
  assert.equal(merged.artworks.length, project.artworks.length);
  assert.deepEqual(merged.artworks[4], art);
  assert.deepEqual(merged.layouts, project.layouts);
  assert.notEqual(project.artworks[4].notes, art.notes);
  const added = mergeCatalog(
    project,
    JSON.parse(catalogJSON([{ ...art, id: 'extra' }])),
    validateProject,
  );
  assert.equal(added.artworks.length, 21);
  const restored = mergeCatalog(
    { ...project, artworks: project.artworks.slice(0, 4) },
    JSON.parse(catalogJSON(suppliedArtworks())),
    validateProject,
  );
  assert.deepEqual(restored, project);
});

test('CSVはBOM・全項目・未入力寸法・引用符・改行を維持し、数式として実行させない', () => {
  const art = { ...suppliedArtworks()[2], notes: '"梱包", 注意\n改行' };
  const csv = catalogCSV([art]);
  assert.ok(csv.startsWith('\uFEFF"作家","作品名"'));
  assert.ok(csv.includes('"\'@KCUA"'));
  assert.ok(csv.includes('"6〜8号（号種未確認）","5","455","380","40","仮寸法"'));
  assert.ok(csv.includes('"""梱包"", 注意\n改行"'));
  for (const title of ['=1+1', ' @SUM(1)', '\t+1', '\n-1'])
    assert.ok(catalogCSV([{ ...art, title }]).includes(`"'${title}"`));
  assert.equal(JSON.parse(catalogJSON([art])).artworks[0].attribute, '@KCUA');
});

test('リストの不正なメタデータ・外部画像・重複・配置中作品の実寸消去を拒否する', () => {
  const project = createProject();
  for (const patch of [
    { year: 2026 },
    { notes: 'x'.repeat(3001) },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: '10' },
    { displayMethod: '__proto__' },
    { image: 'https://example.com/a.png' },
    { image: 'data:image/svg+xml,<svg onload="alert(1)"/>' },
    { width: -1 },
    { dimensionStatus: 'exact-ish' },
    { assemblyColumns: 0 },
    {
      packages: [
        { width: -1, height: 100, depth: null, quantity: 1, approximate: false, upperBound: false },
      ],
    },
    {
      packages: [
        {
          width: 100,
          height: 100,
          depth: null,
          quantity: 0,
          approximate: false,
          upperBound: false,
        },
      ],
    },
  ]) {
    const art = { ...project.artworks[4], ...patch };
    assert.throws(() => mergeCatalog(project, JSON.parse(catalogJSON([art])), validateProject));
  }
  assert.throws(
    () =>
      mergeCatalog(
        project,
        JSON.parse(catalogJSON([project.artworks[4], project.artworks[4]])),
        validateProject,
      ),
    /重複/,
  );
  assert.throws(
    () =>
      mergeCatalog(
        project,
        JSON.parse(catalogJSON([{ ...project.artworks[0], width: null }])),
        validateProject,
      ),
    /配置データ/,
  );
  assert.throws(() =>
    mergeCatalog(project, { ...JSON.parse(catalogJSON([])), version: 999 }, validateProject),
  );
});
