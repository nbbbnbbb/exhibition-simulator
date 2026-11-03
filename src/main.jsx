import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Scene } from './Scene.jsx';
import Plan from './Plan.jsx';
import { PartitionLibrary, PartitionInspector, RailEditor } from './Partitions.jsx';
import {
  createProject,
  validateProject,
  walls,
  fitPlacement,
  layoutIssues,
  distribute,
  positionOnWall,
  DIMENSIONS,
  uid,
  format,
  fitPartition,
  railGeometry,
} from './domain.js';
import { readProject, saveProject, readImage, download } from './storage.js';
import './style.css';
import './partitions.css';

function Icon({ name, size = 18, ...props }) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    cube: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4m-9 4L3 8m9 4v10',
    plan: 'M3 3h18v18H3V3Zm7 0v10H3m7 0h11',
    split: 'M3 4h18v16H3V4Zm9 0v16',
    walk: 'M13 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-3 16 2-6-3-3 2-5 4 4h4m-7 4 5 6M5 13l3-4',
    vr: 'M4 7h16l2 10h-7l-3-3-3 3H2L4 7Zm3 4h1m8 0h1',
    undo: 'M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12',
    redo: 'm16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
    fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    grid: 'M3 3h18v18H3V3Zm6 0v18m6-18v18M3 9h18M3 15h18',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
    image: 'M3 3h18v18H3V3Zm0 14 6-6 4 4 3-3 5 5M15 7h.01',
    check: 'm5 12 4 4L19 6',
    close: 'm6 6 12 12M6 18 18 6',
    copy: 'M8 8h13v13H8V8ZM16 8V3H3v13h5',
    trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
    info: 'M12 11v6m0-10h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
    ruler: 'm3 17 14-14 4 4L7 21l-4-4Zm7-7 2 2m2-6 2 2m-10 6 2 2',
    camera: 'M8 6l2-3h4l2 3h5v15H3V6h5Zm4 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    chevron: 'm9 5 7 7-7 7',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.info} />
    </svg>
  );
}
function Button({ icon, children, className = '', ...p }) {
  return (
    <button className={`button ${className}`} {...p}>
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 150000,
  step = 1,
  unit = 'mm',
  testId,
}) {
  const [v, set] = useState(value);
  useEffect(() => set(value), [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          data-testid={testId}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={v}
          onChange={(e) => set(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(v));
            if (v === '' || !Number.isFinite(n) || n < min || n > max) {
              set(value);
              return;
            }
            if (n !== value) onChange(n);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
function Modal({ title, subtitle, onClose, children, wide = false }) {
  const root = useRef();
  useEffect(() => {
    const before = document.activeElement;
    root.current?.focus();
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focusables = [
          ...root.current.querySelectorAll('button,input,select,textarea,a[href]'),
        ].filter((el) => !el.disabled);
        const first = focusables[0],
          last = focusables.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={root}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">MA / EXHIBITION PLANNER</p>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function App() {
  const [history, setHistory] = useState(() => ({
    past: [],
    present: createProject(),
    future: [],
  }));
  const project = history.present;
  const [loaded, setLoaded] = useState(false),
    [saveStatus, setSaveStatus] = useState('読込中'),
    [storageEnabled, setStorageEnabled] = useState(true);
  const [selectedPartition, setSelectedPartition] = useState(null),
    [partitionFace, setPartitionFace] = useState('front'),
    [showRails, setShowRails] = useState(true);
  const [selected, setSelected] = useState(['p-1']),
    [view, setView] = useState('split'),
    [mode, setMode] = useState('orbit'),
    [grid, setGrid] = useState(false),
    [details, setDetails] = useState(true),
    [light, setLight] = useState(1),
    [eye, setEye] = useState(1600),
    [dimensions, setDimensions] = useState(true),
    [camera, setCamera] = useState(null);
  const [modal, setModal] = useState(null),
    [notice, setNotice] = useState(''),
    [compareId, setCompareId] = useState(''),
    [filter, setFilter] = useState(''),
    [gap, setGap] = useState(500),
    [libraryTab, setLibraryTab] = useState('artworks');
  const scene = useRef(),
    fileImport = useRef();
  const revision = useRef(0),
    queue = useRef(Promise.resolve());
  const layout = project.layouts.find((l) => l.id === project.activeLayoutId),
    compare = project.layouts.find((l) => l.id === compareId && l.id !== layout.id);
  const parts = layout.partitions || [],
    activePart = parts.find((q) => q.id === selectedPartition);
  const ws = walls(project.building, parts, project.rails),
    p = layout.placements.find((p) => p.id === selected[0]),
    a = project.artworks.find((a) => a.id === p?.artworkId),
    w = ws.find((w) => w.id === p?.wallId);
  const issues = layoutIssues(project);
  const tell = useCallback((message) => setNotice(message), []);
  useEffect(() => {
    let live = true;
    readProject()
      .then((d) => {
        if (!live) return;
        if (d) {
          validateProject(d);
          setHistory({ past: [], present: d, future: [] });
          setSelected([]);
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (!live) return;
        setStorageEnabled(false);
        setLoaded(true);
        setSaveStatus('保存停止');
        tell(`保存データを開けません。既存データ保護のため自動保存を停止しました：${err.message}`);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !storageEnabled) return;
    const r = ++revision.current;
    setSaveStatus('保存中…');
    const timer = setTimeout(() => {
      queue.current = queue.current.catch(() => {}).then(() => saveProject(project));
      queue.current
        .then(() => {
          if (revision.current === r) setSaveStatus('保存済み');
        })
        .catch(() => {
          if (revision.current === r) {
            setSaveStatus('保存失敗');
            tell('ブラウザー保存に失敗しました。JSONを書き出して保管してください');
          }
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [project, loaded, storageEnabled]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const update = useCallback(
    (fn) =>
      setHistory((h) => {
        const next = structuredClone(h.present);
        try {
          fn(next);
          validateProject(next);
        } catch (err) {
          setTimeout(() => tell(err.message), 0);
          return h;
        }
        return { past: [...h.past.slice(-39), h.present], present: next, future: [] };
      }),
    [],
  );
  const undo = useCallback(
    () =>
      setHistory((h) =>
        h.past.length
          ? { past: h.past.slice(0, -1), present: h.past.at(-1), future: [h.present, ...h.future] }
          : h,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        h.future.length
          ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
          : h,
      ),
    [],
  );
  const select = useCallback((id, multi = false) => {
    setSelectedPartition(null);
    setSelected((ids) =>
      id ? (multi ? (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]) : [id]) : [],
    );
  }, []);
  const selectPartition = useCallback((id) => {
    setSelected([]);
    setSelectedPartition(id);
  }, []);
  const move = useCallback(
    (id, changes) =>
      update((d) => {
        const l = d.layouts.find((l) => l.id === d.activeLayoutId);
        const p = l.placements.find((p) => p.id === id);
        if (p)
          Object.assign(
            p,
            fitPlacement(
              { ...p, ...changes },
              d.artworks.find((a) => a.id === p.artworkId),
              d.building,
              l.partitions,
              d.rails,
            ),
          );
      }),
    [],
  );
  const remove = useCallback(() => {
    update((d) => {
      const l = d.layouts.find((l) => l.id === d.activeLayoutId);
      l.placements = l.placements.filter((p) => !selected.includes(p.id));
    });
    setSelected([]);
  }, [selected]);
  useEffect(() => {
    const key = (e) => {
      if (
        modal ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      }
      if (e.code === 'Delete' && selected.length) {
        e.preventDefault();
        remove();
      }
      if (e.code === 'Escape') {
        setSelected([]);
        setSelectedPartition(null);
        setMode('orbit');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [modal, selected, undo, redo, remove]);
  function addArtwork(artworkId) {
    let id = uid();
    update((d) => {
      const art = d.artworks.find((a) => a.id === artworkId);
      const l = d.layouts.find((l) => l.id === d.activeLayoutId);
      const wallId = activePart
        ? `partition:${activePart.id}:${partitionFace}`
        : w?.hangable
          ? w.id
          : 'west';
      const onWall = l.placements.filter((p) => p.wallId === wallId);
      const last = onWall.reduce(
        (n, p) => Math.max(n, p.s + d.artworks.find((a) => a.id === p.artworkId).width / 2),
        1000,
      );
      l.placements.push(
        fitPlacement(
          {
            id,
            artworkId,
            wallId,
            s: last + 500 + art.width / 2,
            bottom: Math.max(0, 1500 - art.height / 2),
          },
          art,
          d.building,
          l.partitions,
          d.rails,
        ),
      );
    });
    setSelected([id]);
    setSelectedPartition(null);
  }
  function arrange(manual = false) {
    try {
      const ids =
        selected.length >= 2
          ? selected
          : layout.placements.filter((q) => q.wallId === p?.wallId).map((q) => q.id);
      const result = distribute(layout.placements, project.artworks, ids, manual ? gap : null);
      for (const q of result) {
        const art = project.artworks.find((a) => a.id === q.artworkId),
          wall = ws.find((w) => w.id === q.wallId);
        if (q.s + art.width / 2 > wall.length) throw new Error('指定の間隔では壁面に収まりません');
      }
      update((d) => {
        d.layouts.find((l) => l.id === d.activeLayoutId).placements = result;
      });
      tell(manual ? `${format(gap)} mmの間隔で配置しました` : '作品の端と端の間隔を均等にしました');
    } catch (err) {
      tell(err.message);
    }
  }
  function addPartition(railId) {
    const id = uid();
    update((d) => {
      const l = d.layouts.find((l) => l.id === d.activeLayoutId),
        r = d.rails.find((r) => r.id === railId);
      l.partitions.push(
        fitPartition(
          {
            id,
            name: `可動壁 ${String(l.partitions.length + 1).padStart(2, '0')}`,
            railId,
            s: Math.round(railGeometry(r).length / 2),
            width: 3000,
            height: 5000,
            thickness: 200,
          },
          d.building,
          d.rails,
        ),
      );
    });
    selectPartition(id);
  }
  const changePartition = useCallback(
    (id, changes) =>
      update((d) => {
        const l = d.layouts.find((l) => l.id === d.activeLayoutId),
          i = l.partitions.findIndex((q) => q.id === id);
        if (i < 0) return;
        l.partitions[i] = fitPartition({ ...l.partitions[i], ...changes }, d.building, d.rails);
        l.placements = l.placements.map((p) =>
          p.wallId.startsWith(`partition:${id}:`)
            ? fitPlacement(
                p,
                d.artworks.find((a) => a.id === p.artworkId),
                d.building,
                l.partitions,
                d.rails,
              )
            : p,
        );
      }),
    [],
  );
  function duplicatePartition(part) {
    const id = uid();
    update((d) => {
      const l = d.layouts.find((l) => l.id === d.activeLayoutId);
      l.partitions.push(
        fitPartition(
          { ...part, id, name: `${part.name} コピー`, s: part.s + part.width + 500 },
          d.building,
          d.rails,
        ),
      );
      const copies = l.placements
        .filter((p) => p.wallId.startsWith(`partition:${part.id}:`))
        .map((p) => ({
          ...p,
          id: uid(),
          wallId: p.wallId.replace(`partition:${part.id}:`, `partition:${id}:`),
        }));
      l.placements.push(...copies);
    });
    selectPartition(id);
  }
  function applyRails(rails) {
    try {
      const next = structuredClone(project);
      next.rails = rails;
      for (const l of next.layouts) {
        l.partitions = l.partitions.map((p) => fitPartition(p, next.building, rails));
        l.placements = l.placements.map((p) =>
          fitPlacement(
            p,
            next.artworks.find((a) => a.id === p.artworkId),
            next.building,
            l.partitions,
            rails,
          ),
        );
      }
      validateProject(next);
      update((d) => Object.assign(d, next));
      setModal(null);
      tell('配置ラインを更新しました。可動壁と作品が追従します');
    } catch (err) {
      tell(err.message);
    }
  }
  function exportJSON() {
    download(`${project.name || 'exhibition'}.ma.json`, JSON.stringify(project, null, 2));
    tell('画像・全プラン・建築寸法・可動壁をJSONへ書き出しました');
  }
  function exportCSV() {
    const q = (v) =>
      '"' +
      (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : String(v)).replaceAll('"', '""') +
      '"';
    const rows = [
      [
        'plan',
        'artwork',
        'artist',
        'wall',
        'width_mm',
        'height_mm',
        'depth_mm',
        'wall_center_mm',
        'bottom_mm',
        'center_height_mm',
        'world_x_mm',
        'world_z_mm',
      ],
    ];
    for (const l of project.layouts) {
      const wallList = walls(project.building, l.partitions, project.rails);
      for (const p of l.placements) {
        const a = project.artworks.find((a) => a.id === p.artworkId),
          w = wallList.find((w) => w.id === p.wallId),
          pos = positionOnWall(w, p.s, p.bottom, a);
        rows.push([
          l.name,
          a.title,
          a.artist,
          w.name,
          a.width,
          a.height,
          a.depth,
          p.s,
          p.bottom,
          p.bottom + a.height / 2,
          Math.round(pos.x),
          Math.round(pos.z),
        ]);
      }
    }
    download(
      `${project.name}-設営リスト.csv`,
      '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }

  async function importJSON(file) {
    if (!file) return;
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('JSONは80 MB以内にしてください');
      const d = validateProject(JSON.parse(await file.text()));
      setHistory((h) => ({ past: [...h.past.slice(-39), h.present], present: d, future: [] }));
      setStorageEnabled(true);
      setSelected([]);
      setSelectedPartition(null);
      setCompareId('');
      tell('プロジェクトを取り込みました。直前の状態へは「元に戻す」で戻せます');
    } catch (err) {
      tell(`取り込み失敗：${err.message}`);
    }
    fileImport.current.value = '';
  }
  if (!loaded)
    return (
      <div className="loading">
        <span className="brand-mark">間</span>
        <p>展示空間を準備しています…</p>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">間</span>
          <div>
            <strong>MA</strong>
            <span>EXHIBITION PLANNER</span>
          </div>
        </div>
        <div className="project-title">
          <input
            aria-label="プロジェクト名"
            value={project.name}
            maxLength={200}
            onChange={(e) => update((d) => (d.name = e.target.value))}
          />
          <span className={`save-status ${saveStatus === '保存済み' ? 'saved' : ''}`}>
            <i />
            {saveStatus}
            <span className="local-label"> · このブラウザー</span>
          </span>
        </div>
        <div className="header-actions">
          <Button icon="info" onClick={() => setModal('help')}>
            使い方
          </Button>
          <Button icon="upload" onClick={() => fileImport.current.click()}>
            開く
          </Button>
          <Button icon="download" className="primary" onClick={exportJSON}>
            書き出す
          </Button>
          <input
            ref={fileImport}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => importJSON(e.target.files[0])}
          />
        </div>
      </header>
      <div className="workspace">
        <aside className="library sidebar">
          <div className="sidebar-tabs">
            <button
              className={libraryTab === 'artworks' ? 'active' : ''}
              onClick={() => setLibraryTab('artworks')}
            >
              作品 <small>{project.artworks.length}</small>
            </button>
            <button
              className={libraryTab === 'partitions' ? 'active' : ''}
              onClick={() => setLibraryTab('partitions')}
            >
              可動壁 <small>{parts.length}</small>
            </button>
            <button
              className={libraryTab === 'layouts' ? 'active' : ''}
              onClick={() => setLibraryTab('layouts')}
            >
              プラン <small>{project.layouts.length}</small>
            </button>
          </div>
          {libraryTab === 'artworks' ? (
            <>
              <div className="library-top">
                <p className="muted">作品と、その実寸を管理</p>
                <Button icon="plus" className="full" onClick={() => setModal('add-artwork')}>
                  作品を登録
                </Button>
                <input
                  className="search"
                  aria-label="作品を検索"
                  placeholder="作品を検索…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="artwork-list">
                {project.artworks
                  .filter((a) =>
                    (a.title + ' ' + a.artist).toLowerCase().includes(filter.toLowerCase()),
                  )
                  .map((art, i) => {
                    const count = layout.placements.filter((p) => p.artworkId === art.id).length;
                    return (
                      <article
                        className={`art-card ${art.id === a?.id ? 'current' : ''}`}
                        key={art.id}
                      >
                        <div className="art-thumb">
                          <img src={art.image} alt={art.title} loading="lazy" />
                          <span>{String(i + 1).padStart(2, '0')}</span>
                        </div>
                        <div className="art-card-body">
                          <h3>{art.title}</h3>
                          <p>
                            {format(art.width)} × {format(art.height)} <span>mm</span>
                          </p>
                          <div className="card-actions">
                            <span className={count ? 'placed' : ''}>
                              {count ? `${count} 点配置中` : '未配置'}
                            </span>
                            <button
                              aria-label={`${art.title}を編集`}
                              onClick={() => setModal({ type: 'edit-artwork', id: art.id })}
                            >
                              編集
                            </button>
                            <button
                              className="add-button"
                              aria-label={`${art.title}を配置`}
                              onClick={() => addArtwork(art.id)}
                            >
                              <Icon name="plus" size={15} />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                {!project.artworks.length && (
                  <p className="empty-small">最初の作品を登録してください</p>
                )}
              </div>
              <div className="library-footer">
                <Icon name="image" size={16} />
                <span>
                  サンプル画像は操作確認用です。
                  <br />
                  画像比率より登録した実寸を優先。
                </span>
              </div>
            </>
          ) : libraryTab === 'partitions' ? (
            <PartitionLibrary
              partitions={parts}
              rails={project.rails}
              selected={selectedPartition}
              onSelect={selectPartition}
              onAdd={addPartition}
              onEditRails={() => setModal('rails')}
              showRails={showRails}
              onShowRails={setShowRails}
            />
          ) : (
            <div className="layouts-panel">
              <p className="muted">別案を複製して、配置を比較できます。</p>
              <Button
                icon="copy"
                className="full"
                onClick={() => {
                  const id = uid();
                  update((d) => {
                    const l = structuredClone(d.layouts.find((l) => l.id === d.activeLayoutId));
                    l.id = id;
                    l.name = `プラン ${String.fromCharCode(65 + d.layouts.length)}`;
                    d.layouts.push(l);
                    d.activeLayoutId = id;
                  });
                  setSelected([]);
                  setSelectedPartition(null);
                  setCompareId('');
                }}
              >
                現在のプランを複製
              </Button>
              {project.layouts.map((l) => (
                <div key={l.id} className={`layout-card ${l.id === layout.id ? 'active' : ''}`}>
                  <button
                    className="layout-select"
                    onClick={() => {
                      update((d) => (d.activeLayoutId = l.id));
                      setSelected([]);
                      setSelectedPartition(null);
                      if (compareId === l.id) setCompareId('');
                    }}
                  >
                    <Icon name="layers" />
                    <span>
                      {l.name}
                      <small>{l.placements.length} 点の作品</small>
                    </span>
                    {l.id === layout.id && <Icon name="check" size={16} />}
                  </button>
                  <input
                    aria-label={`${l.name}の名前`}
                    value={l.name}
                    onChange={(e) =>
                      update((d) => (d.layouts.find((q) => q.id === l.id).name = e.target.value))
                    }
                    maxLength={200}
                  />
                  <button
                    className="text-danger"
                    disabled={project.layouts.length <= 1}
                    onClick={() => setModal({ type: 'delete-layout', id: l.id })}
                  >
                    削除
                  </button>
                </div>
              ))}
              <div className="compare-control">
                <label htmlFor="compare-select">比較するプラン</label>
                <select
                  id="compare-select"
                  value={compareId}
                  onChange={(e) => setCompareId(e.target.value)}
                >
                  <option value="">比較しない</option>
                  {project.layouts
                    .filter((l) => l.id !== layout.id)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
                {compare && (
                  <p className="compare-caption">
                    紫の輪郭：{compare.name}
                    <br />
                    現在 {layout.placements.length} 点 / 比較 {compare.placements.length} 点
                  </p>
                )}
              </div>
              <Button icon="download" className="full" onClick={exportCSV}>
                全プランの設営CSV
              </Button>
              <Button icon="cube" className="full" onClick={() => scene.current?.exportGLB()}>
                現在の空間をGLB保存
              </Button>
            </div>
          )}
        </aside>
        <main className="main-workspace">
          <div className="workspace-title">
            <div>
              <p className="eyebrow">GALLERY / 01</p>
              <h1>展示を、空間で考える。</h1>
            </div>
            <button className="building-chip" onClick={() => setModal('building')}>
              <span className="status-dot" />
              建築・寸法データ
              <Icon name="chevron" size={14} />
            </button>
          </div>
          <div className="view-toolbar">
            <div className="segmented view-modes">
              {[
                ['three', 'cube', '3D'],
                ['plan', 'plan', '平面'],
                ['split', 'split', '並べる'],
              ].map(([id, icon, label]) => (
                <button
                  aria-pressed={view === id}
                  className={view === id ? 'active' : ''}
                  key={id}
                  onClick={() => setView(id)}
                >
                  <Icon name={icon} size={16} />
                  {label}
                </button>
              ))}
            </div>
            <div className="toolbar-separator" />
            <button
              title="元に戻す (Ctrl+Z)"
              className="icon-button"
              disabled={!history.past.length}
              onClick={undo}
              aria-label="元に戻す"
            >
              <Icon name="undo" size={17} />
            </button>
            <button
              title="やり直す (Ctrl+Shift+Z)"
              className="icon-button"
              disabled={!history.future.length}
              onClick={redo}
              aria-label="やり直す"
            >
              <Icon name="redo" size={17} />
            </button>
            <div className="toolbar-spacer" />
            <button
              title="全体を表示"
              className="icon-button"
              aria-label="全体を表示"
              onClick={() => {
                setMode('orbit');
                scene.current?.fit();
              }}
            >
              <Icon name="fit" />
            </button>
            <button
              title="1 mグリッド"
              aria-pressed={grid}
              className={`icon-button ${grid ? 'on' : ''}`}
              aria-label="グリッド"
              onClick={() => setGrid(!grid)}
            >
              <Icon name="grid" />
            </button>
            <button
              title="寸法表示"
              aria-pressed={dimensions}
              className={`icon-button ${dimensions ? 'on' : ''}`}
              aria-label="寸法表示"
              onClick={() => setDimensions(!dimensions)}
            >
              <Icon name="ruler" />
            </button>
            <button
              title="3D画像を保存"
              className="icon-button"
              aria-label="3D画像を保存"
              onClick={() => scene.current?.screenshot()}
            >
              <Icon name="camera" />
            </button>
          </div>
          <div className={`viewport view-${view}`}>
            <section
              className="three-panel"
              style={view === 'plan' ? { display: 'none' } : undefined}
            >
              <Scene
                ref={scene}
                project={project}
                selected={selected}
                compare={compare}
                mode={mode}
                grid={grid}
                details={details}
                light={light}
                eye={eye}
                selectedPartition={selectedPartition}
                showRails={showRails}
                onSelectPartition={selectPartition}
                onPartitionMove={changePartition}
                onSelect={select}
                onMove={move}
                onNotice={tell}
                onCamera={setCamera}
              />
              <div className="canvas-label">
                <span className="live-dot" /> {mode === 'walk' ? 'WALKTHROUGH' : 'PERSPECTIVE'}
                <small>1 unit = 1 m</small>
              </div>
              <div className="canvas-controls">
                <div className="segmented">
                  <button
                    className={mode === 'orbit' ? 'active' : ''}
                    onClick={() => setMode('orbit')}
                  >
                    <Icon name="cube" size={16} />
                    俯瞰
                  </button>
                  <button
                    className={mode === 'walk' ? 'active' : ''}
                    onClick={() => {
                      setMode('walk');
                      setView((v) => (v === 'plan' ? 'split' : v));
                    }}
                  >
                    <Icon name="walk" size={16} />
                    歩く
                  </button>
                </div>
                <button className="vr-button" onClick={() => scene.current?.enterVR()}>
                  <Icon name="vr" size={18} />
                  VR <span>1:1</span>
                </button>
              </div>
              {mode === 'walk' && (
                <div className="walk-hint">
                  WASD 移動 · ドラッグで視線 · 矢印で旋回 · Esc で俯瞰
                </div>
              )}
              {view === 'three' && (
                <div className="mini-map">
                  <Plan
                    project={project}
                    selected={selected}
                    compare={compare}
                    onSelect={select}
                    onMove={move}
                    camera={camera}
                    mini
                    selectedPartition={selectedPartition}
                    onSelectPartition={selectPartition}
                    onPartitionMove={changePartition}
                    showRails={showRails}
                  />
                </div>
              )}
              <div className="viewport-help">
                {mode === 'orbit'
                  ? 'ドラッグで回転 · ホイールで拡縮 · 右ドラッグで平行移動'
                  : '歩行速度 1.3 m/s · 壁・柱との衝突判定あり'}
              </div>
            </section>
            <section
              className="plan-panel"
              style={view === 'three' ? { display: 'none' } : undefined}
            >
              <div className="plan-heading">
                <span>
                  PLAN <small>平面図</small>
                </span>
                <span className="scale-badge">単位 mm</span>
              </div>
              <Plan
                project={project}
                selected={selected}
                compare={compare}
                onSelect={select}
                onMove={move}
                camera={mode === 'walk' ? camera : null}
                showDimensions={dimensions}
                selectedPartition={selectedPartition}
                onSelectPartition={selectPartition}
                onPartitionMove={changePartition}
                showRails={showRails}
              />
              <div className="plan-legend">
                <span>
                  <i />
                  配置作品
                </span>
                {compare && (
                  <span className="purple">
                    <i />
                    比較プラン
                  </span>
                )}
                <small>図面上端を上に表示</small>
              </div>
            </section>
          </div>
          <div className="bottom-controls">
            <div className="lighting">
              <Icon name="sun" size={17} />
              <span>明るさ</span>
              <input
                aria-label="明るさ"
                type="range"
                min=".4"
                max="1.8"
                step=".1"
                value={light}
                onChange={(e) => setLight(+e.target.value)}
              />
              <small>{Math.round(light * 100)}%</small>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={details}
                onChange={(e) => setDetails(e.target.checked)}
              />
              梁・中二階
            </label>
            <div className="toolbar-spacer" />
            <span
              className="dimension-warning"
              onClick={() => setModal('building')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setModal('building');
              }}
            >
              <Icon name="info" size={14} />
              全長・高さに暫定値あり
            </span>
          </div>
          <footer className="status-bar">
            <span>
              <i className="status-dot" />
              {layout.name} <b> / </b> {layout.placements.length} 点配置
            </span>
            <span>
              {selected.length ? `${selected.length} 点選択` : '作品を選択して位置を編集'}
              <b> / </b>座標精度 1 mm
            </span>
          </footer>
        </main>
        <aside className="inspector sidebar">
          <div className="inspector-heading">
            <h2>配置の詳細</h2>
            <span className="tag">mm</span>
          </div>
          {activePart ? (
            <PartitionInspector
              partition={activePart}
              rails={project.rails}
              face={partitionFace}
              onFace={setPartitionFace}
              onChange={(changes) => changePartition(activePart.id, changes)}
              onRemove={() => setModal({ type: 'delete-partition', id: activePart.id })}
              onDuplicate={() => duplicatePartition(activePart)}
              onLibrary={() => setLibraryTab('artworks')}
            />
          ) : p && a && w ? (
            <>
              <div className="selected-summary">
                <img src={a.image} alt="選択中の作品" />
                <div>
                  <span className="eyebrow">SELECTED WORK</span>
                  <h3>{a.title}</h3>
                  <p>{a.artist || '作者未登録'}</p>
                </div>
              </div>
              <div className="inspector-section">
                <Button
                  className="full subtle"
                  icon="fit"
                  onClick={() => {
                    setMode('orbit');
                    setView((v) => (v === 'plan' ? 'split' : v));
                    scene.current?.focus(p.id);
                  }}
                >
                  作品を正面から確認
                </Button>
                <label className="select-label" style={{ marginTop: 15 }}>
                  壁面
                  <select
                    aria-label="配置する壁面"
                    value={p.wallId}
                    onChange={(e) => move(p.id, { wallId: e.target.value })}
                  >
                    {ws
                      .filter((w) => w.hangable)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="field-note">使用できる長さ {format(w.length)} mm</p>
                <NumberField
                  label="壁面起点から作品中心"
                  testId="position-s"
                  value={p.s}
                  min={0}
                  max={150000}
                  onChange={(s) => move(p.id, { s })}
                />
                <NumberField
                  label="床から作品下端"
                  testId="position-bottom"
                  value={p.bottom}
                  max={20000}
                  onChange={(bottom) => move(p.id, { bottom })}
                />
                <div className="center-height">
                  <span>作品中心の高さ</span>
                  <strong>
                    {format(p.bottom + a.height / 2)} <small>mm</small>
                  </strong>
                </div>
                <Button
                  className="full subtle"
                  onClick={() => {
                    const ids = selected;
                    update((d) => {
                      const l = d.layouts.find((l) => l.id === d.activeLayoutId);
                      l.placements = l.placements.map((q) =>
                        ids.includes(q.id)
                          ? fitPlacement(
                              {
                                ...q,
                                bottom: Math.max(
                                  0,
                                  1500 - d.artworks.find((a) => a.id === q.artworkId).height / 2,
                                ),
                              },
                              d.artworks.find((a) => a.id === q.artworkId),
                              d.building,
                              l.partitions,
                              d.rails,
                            )
                          : q,
                      );
                    });
                  }}
                >
                  中心高を 1,500 mm に揃える
                </Button>
              </div>
              <div className="inspector-section">
                <div className="section-label">
                  作品の実寸{' '}
                  <button onClick={() => setModal({ type: 'edit-artwork', id: a.id })}>編集</button>
                </div>
                <div className="size-readout">
                  <span>
                    幅<strong>{format(a.width)}</strong>
                  </span>
                  <b>×</b>
                  <span>
                    高さ<strong>{format(a.height)}</strong>
                  </span>
                  <b>×</b>
                  <span>
                    厚み<strong>{format(a.depth)}</strong>
                  </span>
                </div>
                <p className="field-note">フレームを含む外寸。全プランで共通。</p>
              </div>
              <div className="inspector-section">
                <div className="section-label">
                  間隔と整列{' '}
                  <span>{selected.length >= 2 ? `${selected.length} 点` : 'この壁の全作品'}</span>
                </div>
                <Button className="full" icon="ruler" onClick={() => arrange(false)}>
                  両端を固定して等間隔
                </Button>
                <div className="gap-row">
                  <NumberField label="作品間のすき間" value={gap} max={20000} onChange={setGap} />
                  <Button onClick={() => arrange(true)}>適用</Button>
                </div>
                <p className="field-note">
                  Shift＋クリックで複数選択。
                  <br />
                  間隔は作品の端から端で計算します。
                </p>
              </div>
              <div className="inspector-section">
                <div className="placement-actions">
                  <Button
                    icon="copy"
                    onClick={() => {
                      const id = uid();
                      update((d) => {
                        const l = d.layouts.find((l) => l.id === d.activeLayoutId);
                        l.placements.push(
                          fitPlacement(
                            { ...p, id, s: p.s + a.width + 500 },
                            a,
                            d.building,
                            l.partitions,
                            d.rails,
                          ),
                        );
                      });
                      setSelected([id]);
                      setSelectedPartition(null);
                    }}
                  >
                    複製
                  </Button>
                  <Button icon="trash" className="danger" onClick={remove}>
                    配置解除
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="inspector-empty">
              <div className="empty-icon">
                <Icon name="ruler" size={32} />
              </div>
              <h3>配置を整える</h3>
              <p>3Dまたは平面図の作品を選ぶと、位置や高さを数値で編集できます。</p>
              <p>
                左のライブラリから
                <br />＋ で作品を壁に配置します。
              </p>
            </div>
          )}
          <div className="inspector-bottom">
            <NumberField
              label="歩行時の目線高さ"
              value={eye}
              min={800}
              max={2100}
              onChange={setEye}
            />
            {issues.length > 0 ? (
              <button className="issues-button" onClick={() => setModal('issues')}>
                <Icon name="info" size={15} />
                {issues.length} 件の配置確認
              </button>
            ) : (
              <span className="valid-label">
                <Icon name="check" size={15} />
                重なり・壁面範囲を確認済み
              </span>
            )}
          </div>
        </aside>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          <span>{notice}</span>
          <button aria-label="通知を閉じる" onClick={() => setNotice('')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {(modal === 'add-artwork' || modal?.type === 'edit-artwork') && (
        <ArtworkModal
          art={project.artworks.find((a) => a.id === modal.id)}
          onClose={() => setModal(null)}
          onSave={(art) => {
            try {
              const next = structuredClone(project);
              const i = next.artworks.findIndex((a) => a.id === art.id);
              if (i < 0) next.artworks.push(art);
              else next.artworks[i] = art;
              for (const l of next.layouts)
                l.placements = l.placements.map((p) =>
                  p.artworkId === art.id
                    ? fitPlacement(p, art, next.building, l.partitions, next.rails)
                    : p,
                );
              validateProject(next);
              update((d) => Object.assign(d, next));
              setModal(null);
            } catch (err) {
              tell(err.message);
            }
          }}
          onDelete={(id) => {
            update((d) => {
              d.artworks = d.artworks.filter((a) => a.id !== id);
              for (const l of d.layouts)
                l.placements = l.placements.filter((p) => p.artworkId !== id);
            });
            setModal(null);
            setSelected([]);
          }}
          tell={tell}
        />
      )}
      {modal === 'building' && (
        <BuildingModal
          building={project.building}
          onClose={() => setModal(null)}
          onSave={(building) => {
            try {
              const next = structuredClone(project);
              next.building = building;
              validateProject(next);
              for (const l of next.layouts)
                l.placements = l.placements.map((p) =>
                  fitPlacement(
                    p,
                    next.artworks.find((a) => a.id === p.artworkId),
                    building,
                    l.partitions,
                    next.rails,
                  ),
                );
              update((d) => Object.assign(d, next));
              setModal(null);
              tell('建築寸法を更新しました。壁面を超えた配置は範囲内へ調整しました');
            } catch (err) {
              tell(err.message);
            }
          }}
        />
      )}
      {modal === 'rails' && (
        <Modal
          title="可動壁の配置ライン"
          subtitle="点線は可動壁を置けるラインです。初期座標は点線の相対位置からの推定で、PDFの1/100換算値ではありません。実測後に修正してください。"
          onClose={() => setModal(null)}
          wide
        >
          <RailEditor rails={project.rails} onApply={applyRails} />
        </Modal>
      )}
      {modal?.type === 'delete-partition' && (
        <Modal
          title="可動壁を削除しますか"
          subtitle="このプランの可動壁と、その両面に配置した作品の配置を削除します。作品ライブラリは残ります。操作後は元に戻せます。"
          onClose={() => setModal(null)}
        >
          <div className="modal-footer">
            <Button onClick={() => setModal(null)}>キャンセル</Button>
            <Button
              className="danger"
              onClick={() => {
                update((d) => {
                  const l = d.layouts.find((l) => l.id === d.activeLayoutId);
                  l.partitions = l.partitions.filter((p) => p.id !== modal.id);
                  l.placements = l.placements.filter(
                    (p) => !p.wallId.startsWith(`partition:${modal.id}:`),
                  );
                });
                setSelectedPartition(null);
                setModal(null);
              }}
            >
              可動壁を削除
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="はじめての展示計画"
          subtitle="寸法を確かめ、作品を並べ、空間で確認する。"
          onClose={() => setModal(null)}
          wide
        >
          <div className="help-grid">
            <div>
              <h3>01 / 作品を登録する</h3>
              <p>
                「作品を登録」でJPEG・PNG・WebP画像と、額を含む幅・高さ・厚みをmmで入力。画像は最大2,048
                pxに最適化し、このブラウザー内に保存します。
              </p>
              <h3>02 / 壁に配置する</h3>
              <p>
                ライブラリの＋で配置。作品を選び、壁面・起点からの中心距離・床からの下端高さを編集します。3Dでは上下左右、平面図では壁に沿ってドラッグできます。通常10
                mm、3DでAltを押すと1 mm刻み。
              </p>
              <h3>03 / 揃える・比較する</h3>
              <p>
                Shift＋クリックで複数選択。「等間隔」は両端の作品を固定して作品間のすき間を均等にします。1点選択時は同じ壁の全作品が対象。「プラン」で複製し、比較するプランを選ぶと紫の輪郭を重ねます。
              </p>
            </div>
            <div>
              <h3>04 / 歩く・VRで見る</h3>
              <p>
                「歩く」でWASD移動、ドラッグで視線、左右矢印で旋回。目線高さは右下で変更。VRは対応HMDのブラウザーでHTTPS接続、またはPC接続のlocalhostから「VR」。local-floor基準で1
                mを実空間1 mとして表示します。
              </p>
              <p>
                VRではトリガーを押して床に向け、離してテレポート。左スティックで前後、右スティックで30°旋回。実機でのスケール確認は未実施です。
              </p>
              <h3>05 / 保存と持ち出し</h3>
              <p>
                操作はIndexedDBへ自動保存。「書き出す」で画像・建築・全プランを含むJSONを保存し、「開く」で復元できます。ブラウザーのデータ消去に備え、JSONを定期的に保管してください。プランタブから設営CSVを書き出せます。
              </p>
              <h3>寸法について</h3>
              <p>
                PDFデータを厳密な1/100とは仮定していません。寸法列の対象範囲は未確定です。梁・柱・天井高・中二階は推定です。「建築・寸法データ」に根拠と差異を記載。施工前の採寸・避難計画・照度測定を代替するものではありません。
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <span>Ctrl+Z 元に戻す / Ctrl+Shift+Z やり直す / Delete 配置解除</span>
            <Button className="primary" onClick={() => setModal(null)}>
              展示を計画する
              <Icon name="arrow" size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'issues' && (
        <Modal title="配置の確認" onClose={() => setModal(null)}>
          <p className="muted">重なりや壁面範囲を確認してください。</p>
          <div className="issues-list">
            {issues.map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  if (q.type === 'partition') selectPartition(q.id);
                  else select(q.id);
                  setModal(null);
                }}
              >
                <Icon name="info" />
                {q.message}
                <Icon name="chevron" size={15} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal?.type === 'delete-layout' && (
        <Modal
          title="プランを削除しますか"
          subtitle="他のプランと作品ライブラリは残ります。削除後は元に戻すことができます。"
          onClose={() => setModal(null)}
        >
          <div className="modal-footer">
            <Button onClick={() => setModal(null)}>キャンセル</Button>
            <Button
              className="danger"
              onClick={() => {
                update((d) => {
                  d.layouts = d.layouts.filter((l) => l.id !== modal.id);
                  if (d.activeLayoutId === modal.id) d.activeLayoutId = d.layouts[0].id;
                });
                setModal(null);
                setSelected([]);
                setSelectedPartition(null);
                setCompareId('');
              }}
            >
              プランを削除
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ArtworkModal({ art, onClose, onSave, onDelete, tell }) {
  const [draft, setDraft] = useState(() =>
    art
      ? { ...art }
      : { id: uid(), title: '', artist: '', width: 600, height: 800, depth: 30, image: '' },
  );
  const [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [error, setError] = useState('');
  const input = useRef();
  const edit = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  async function imageFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const image = await readImage(file);
      setDraft((d) => ({ ...d, image, title: d.title || file.name.replace(/\.[^.]+$/, '') }));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={art ? '作品を編集' : '作品を登録'}
      subtitle="額・支持体を含む外寸をmmで入力してください。"
      onClose={onClose}
    >
      <div className="artwork-form">
        <button
          className={`upload-zone ${draft.image ? 'has-image' : ''}`}
          onClick={() => input.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            imageFile(e.dataTransfer.files[0]);
          }}
        >
          {draft.image ? (
            <img src={draft.image} alt="作品画像プレビュー" />
          ) : (
            <>
              <Icon name="image" size={34} />
              <strong>{busy ? '画像を処理中…' : '画像をドロップ、または選択'}</strong>
              <small>JPEG / PNG / WebP · 最大30 MB</small>
            </>
          )}
          <span>{draft.image ? '画像を変更' : ''}</span>
        </button>
        <input
          type="file"
          ref={input}
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => imageFile(e.target.files[0])}
        />
        <label className="text-field">
          作品名
          <input
            aria-label="作品名"
            value={draft.title}
            maxLength={300}
            onChange={(e) => edit('title', e.target.value)}
          />
        </label>
        <label className="text-field">
          作者 / メモ
          <input
            aria-label="作者"
            value={draft.artist}
            maxLength={300}
            onChange={(e) => edit('artist', e.target.value)}
          />
        </label>
        <div className="three-fields">
          <NumberField
            label="幅"
            value={draft.width}
            min={1}
            max={30000}
            onChange={(v) => edit('width', v)}
          />
          <NumberField
            label="高さ"
            value={draft.height}
            min={1}
            max={20000}
            onChange={(v) => edit('height', v)}
          />
          <NumberField
            label="厚み"
            value={draft.depth}
            min={1}
            max={1000}
            onChange={(v) => edit('depth', v)}
          />
        </div>
        <p className="field-note">画像の縦横比にかかわらず、この寸法で表示します。</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        {art ? (
          <button
            className="text-danger"
            onClick={() => (confirmDelete ? onDelete(art.id) : setConfirmDelete(true))}
          >
            {confirmDelete ? '全プランから作品を削除する' : '作品を削除'}
          </button>
        ) : (
          <span />
        )}
        <Button
          className="primary"
          disabled={busy}
          onClick={() => {
            if (!draft.image || !draft.title.trim()) {
              setError('作品名と画像を指定してください');
              return;
            }
            onSave({ ...draft, title: draft.title.trim() });
          }}
        >
          {' '}
          {art ? '変更を保存' : 'ライブラリに登録'}
          <Icon name="check" size={16} />
        </Button>
      </div>
    </Modal>
  );
}
function BuildingModal({ building, onClose, onSave }) {
  const [draft, setDraft] = useState({ ...building }),
    [tab, setTab] = useState('sources');
  const names = {
    mainWidth: '主室 幅',
    overallWidth: '全体 幅',
    length: '全長',
    wingDepth: '西室 奥行',
    height: '天井高',
    wallThickness: '壁厚（平面表示）',
    beamDepth: '梁せい',
    beamWidth: '梁幅',
    beamPitch: '梁間隔',
    mezzanineHeight: '中二階 床高',
    columnSize: '柱幅',
    sideDoorAt: '西扉 開口起点',
    sideDoorWidth: '西扉 開口幅',
    eastDoorAt: '東扉 開口起点',
    eastDoorWidth: '東扉 開口幅',
  };
  return (
    <Modal
      title="建築・寸法データ"
      subtitle="図面記載値・算出値・推定を区別して管理します。座標の原点は主室の北西内隅です。"
      onClose={onClose}
      wide
    >
      <div className="modal-tabs">
        <button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}>
          根拠と未確定箇所
        </button>
        <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
          採用寸法を編集
        </button>
        <button className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}>
          図面と写真
        </button>
      </div>
      {tab === 'sources' ? (
        <>
          <div className="source-alert">
            <Icon name="info" />
            <div>
              <strong>寸法列の合計差 2,762 mm / 幅基準の差 133 mm</strong>
              <p>
                PDFデータは厳密な1/100とは限りません。線の長さからの実寸換算を行わず、記載数値を優先します。左右の寸法列は基準点・対象範囲が未確定です。可動壁の配置ライン（点線）の座標は相対位置からの推定で、編集できます。
              </p>
            </div>
          </div>
          <div className="dimension-table">
            {DIMENSIONS.map((d) => (
              <div className="dimension-row" key={d.key}>
                <div>
                  <strong>{d.label}</strong>
                  <span className={d.source === '推定' ? 'source-tag estimate' : 'source-tag'}>
                    {d.source}
                  </span>
                </div>
                <div>
                  <b>{d.value}</b>
                  {building[d.key] !== undefined && (
                    <small>現在 {format(building[d.key])} mm</small>
                  )}
                  <p>{d.note}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : tab === 'edit' ? (
        <>
          <p className="muted">
            基準点を確認した寸法・実測値を入手したら、ここを変更してください。変更は全プランの建築に反映されます。
          </p>
          <div className="building-fields">
            {Object.entries(names).map(([key, label]) => (
              <NumberField
                key={key}
                label={label}
                value={draft[key]}
                min={1}
                max={150000}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              />
            ))}
          </div>
          <div className="modal-footer">
            <span>配置は変更後の壁面に収まるよう調整されます。</span>
            <Button className="primary" onClick={() => onSave(draft)}>
              建築寸法を適用
            </Button>
          </div>
        </>
      ) : (
        <div className="reference-panel">
          <a href="/references/1_100.pdf" target="_blank" rel="noreferrer">
            <Icon name="download" />
            添付の1/100図面を開く
          </a>
          <div>
            <img src="/references/interior-01.png" alt="主展示室の梁と照明の参考写真" />
            <img src="/references/interior-02.png" alt="中二階と柱の参考写真" />
          </div>
          <p className="muted">写真は建築形態・素材の参照です。写真から実寸を確定していません。</p>
        </div>
      )}
    </Modal>
  );
}
class ErrorBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="loading">
        <h2>画面を開けませんでした</h2>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>再読み込み</button>
        <p>ブラウザーの保存データは削除されていません。</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
