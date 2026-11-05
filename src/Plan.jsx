import { useRef, useEffect } from 'react';
import { walls, polygon, format, fitPartition, partitionGeometry } from './domain.js';
import {
  previewArtworkAddition,
  artworkBatchDimensions,
  previewMove,
  pickPlanWall,
} from './artworkPlacement.js';
import { artworkLabelRows } from './artworkLabels.js';
import { frameGeometry, validateFrame } from './steelFrames.js';
import { detectSteelLineFaces } from './steelLineFaces.js';
import { pickPartitionRail, previewPartition } from './partitionPlacement.js';
export default function Plan({
  project,
  selected,
  compare,
  onSelect,
  onObjectContextMenu,
  onMoveGroup,
  camera,
  showDimensions = true,
  mini = false,
  selectedPartition,
  onSelectPartition,
  onPartitionMove,
  selectedSteelFrame,
  onSelectSteelFrame,
  onSteelFrameMove,
  selectedSteelLineFace,
  onSelectSteelLineFace,
  showRails = false,
  placingPartition = false,
  partitionPreview,
  onPartitionPreview,
  onPlacePartition,
  placingArtworkId,
  placingArtworkBatch,
  movingPlacementId,
  movingPlacementIds = [],
  onMoveStart,
  onMoveEnd,
  onNotice,
  placementPreview,
  onPreview,
  onPlace,
  labelSettings,
}) {
  const svg = useRef();
  const drag = useRef();
  const steelDrag = useRef();
  const b = project.building,
    layout = project.layouts.find((l) => l.id === project.activeLayoutId),
    ws = walls(b, layout.partitions, project.rails);
  const x = b.mainWidth - b.overallWidth;
  const pad = mini ? 1300 : 3300;
  const sw = mini ? 150 : 70;
  const steelPoints = [...(layout.steelFrames || []), ...(compare?.steelFrames || [])].flatMap(
    (f) => frameGeometry(f, project).nodes,
  );
  const extentPoints = [
    ...polygon(b).map(([x, z]) => [x, z]),
    ...steelPoints.map(([x, , z]) => [x, z]),
  ];
  const minX = Math.min(...extentPoints.map((p) => p[0])),
    maxX = Math.max(...extentPoints.map((p) => p[0]));
  const minZ = Math.min(...extentPoints.map((p) => p[1])),
    maxZ = Math.max(...extentPoints.map((p) => p[1]));
  useEffect(() => {
    const cancel = () => {
      if (steelDrag.current) {
        steelDrag.current.element.removeAttribute('transform');
        steelDrag.current = null;
      }
      if (drag.current && drag.current.type !== 'partition') {
        drag.current = null;
        onMoveEnd?.();
      }
    };
    const key = (event) => {
      if (event.code === 'Escape') cancel();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
    };
  }, [onMoveEnd]);
  const point = (e) => {
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current.getScreenCTM().inverse());
  };
  const pointerPreview = (e) => {
    const d = drag.current,
      moving = d && d.type !== 'partition';
    if (mini || (!placingArtworkId && !moving)) return null;
    const pos = point(e),
      scale = svg.current.getScreenCTM();
    const tolerance = 20 / Math.hypot(scale.a, scale.b);
    const r = svg.current.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const nearest = inside && pickPlanWall(project, { x: pos.x, z: pos.y }, tolerance);
    const art = project.artworks.find((a) => a.id === (moving ? d.p.artworkId : placingArtworkId));
    const result =
      nearest?.wall.hangable && art
        ? moving
          ? previewMove(
              project,
              d.p.id,
              {
                wallId: nearest.wall.id,
                s:
                  Math.round(
                    (nearest.s -
                      d.grabX *
                        (nearest.wall.normal.z * nearest.wall.tangent.x -
                          nearest.wall.normal.x * nearest.wall.tangent.z)) /
                      (e.altKey ? 1 : 10),
                  ) * (e.altKey ? 1 : 10),
                bottom: d.p.bottom,
              },
              d.ids,
            )
          : previewArtworkAddition(
              project,
              art.id,
              {
                id: 'preview',
                wallId: nearest.wall.id,
                s: Math.round(nearest.s),
                bottom: Math.max(
                  0,
                  Math.round(1500 - artworkBatchDimensions(art, placingArtworkBatch).height / 2),
                ),
              },
              placingArtworkBatch,
            )
        : {
            placement: null,
            valid: false,
            message: nearest ? 'ガラス面には配置できません' : '平面図の壁面を指してください',
          };
    result.source = 'plan';
    if (moving) d.preview = result;
    onPreview?.(result);
    return result;
  };
  const pointerPartitionPreview = (e) => {
    const pos = point(e),
      scale = svg.current.getScreenCTM();
    const candidate = pickPartitionRail(
      project.rails,
      { x: pos.x, z: pos.y },
      16 / Math.hypot(scale.a, scale.b),
    );
    const result = { ...previewPartition(project, candidate, e.altKey), source: 'plan' };
    onPartitionPreview?.(result);
    return result;
  };
  const down = (e, p) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (mini || multi) {
      onSelect(p.id, multi);
      return;
    }
    const ids = selected.includes(p.id) ? [...selected] : [p.id];
    if (!selected.includes(p.id)) onSelect(p.id);
    const w = ws.find((w) => w.id === p.wallId);
    const start = point(e);
    drag.current = {
      p,
      ids,
      w,
      start,
      startClient: { x: e.clientX, y: e.clientY },
      grabX:
        ((start.x - w.start.x) * w.tangent.x + (start.y - w.start.z) * w.tangent.z - p.s) *
        (w.normal.z * w.tangent.x - w.normal.x * w.tangent.z),
      started: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const downPart = (e, p) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectPartition(p.id);
    if (mini) return;
    drag.current = {
      type: 'partition',
      p,
      w: partitionGeometry(p, project.rails),
      start: point(e),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const steelDown = (e, f) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectSteelFrame?.(f.id);
    if (mini) return;
    steelDrag.current = { f, start: point(e), element: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const steelMove = (e) => {
    const d = steelDrag.current;
    if (!d) return;
    e.stopPropagation();
    const pos = point(e),
      step = e.altKey ? 1 : 10;
    const next = {
      ...d.f,
      x: Math.round((d.f.x + pos.x - d.start.x) / step) * step,
      z: Math.round((d.f.z + pos.y - d.start.y) / step) * step,
    };
    try {
      validateFrame(next, project);
      d.next = next;
      d.element.setAttribute('transform', `translate(${next.x - d.f.x},${next.z - d.f.z})`);
    } catch {}
  };
  const steelUp = (e) => {
    const d = steelDrag.current;
    steelDrag.current = null;
    if (!d) return;
    e.stopPropagation();
    d.element.removeAttribute('transform');
    if (e.type === 'pointerup' && d.next && (d.next.x !== d.f.x || d.next.z !== d.f.z))
      onSteelFrameMove?.(d.f.id, { x: d.next.x, z: d.next.z });
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.type !== 'partition') {
      if (!d.started) {
        if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < 3) return;
        d.started = true;
        onMoveStart?.(d.p.id, d.ids);
      }
      pointerPreview(e);
      return;
    }
    const pos = point(e);
    const ds = (pos.x - d.start.x) * d.w.tangent.x + (pos.y - d.start.y) * d.w.tangent.z;
    try {
      d.next = fitPartition({ ...d.p, s: Math.round((d.p.s + ds) / 10) * 10 }, b, project.rails);
    } catch {
      return;
    }
    const g = e.currentTarget;
    const dx = (d.next.s - d.p.s) * d.w.tangent.x,
      dz = (d.next.s - d.p.s) * d.w.tangent.z;
    g.setAttribute('transform', `translate(${dx},${dz})`);
    if (d.type === 'partition')
      svg.current
        .querySelectorAll(`[data-partition-owner="${d.p.id}"]`)
        .forEach((el) => el.setAttribute('transform', `translate(${dx},${dz})`));
  };
  const up = (e) => {
    const d = drag.current;
    if (d && d.type !== 'partition' && d.started && e.type === 'pointerup') pointerPreview(e);
    drag.current = null;
    e.currentTarget.removeAttribute('transform');
    if (d?.type === 'partition')
      svg.current
        .querySelectorAll('[data-partition-owner]')
        .forEach((el) => el.removeAttribute('transform'));
    if (d && d.type !== 'partition') {
      if (d.started && e.type === 'pointerup') {
        const p = d.preview?.placement;
        if (
          d.preview?.valid &&
          (p.wallId !== d.p.wallId || p.s !== d.p.s || p.bottom !== d.p.bottom)
        )
          onMoveGroup(d.p.id, p, d.ids);
        else if (!d.preview?.valid) onNotice?.(d.preview?.message || '移動を取り消しました');
      }
      onMoveEnd?.();
    } else if (d?.next && e.type === 'pointerup') onPartitionMove(d.p.id, d.next);
  };
  const label = (tx, tz, text, rotate = 0) => (
    <text
      x={tx}
      y={tz}
      transform={rotate ? `rotate(${rotate},${tx},${tz})` : undefined}
      textAnchor="middle"
      className="plan-label"
    >
      {text}
    </text>
  );
  const art = (p, ghost = false) => {
    const a = project.artworks.find((a) => a.id === p.artworkId),
      w = (ghost ? walls(b, compare.partitions, project.rails) : ws).find((w) => w.id === p.wallId);
    if (!a || !w) return null;
    const px = w.start.x + w.tangent.x * p.s,
      pz = w.start.z + w.tangent.z * p.s;
    const thick = mini ? 380 : 210;
    const selectedArt = selected.includes(p.id);
    return (
      <g
        data-placement-id={ghost ? undefined : p.id}
        data-partition-owner={ghost ? undefined : w.partitionId}
        key={(ghost ? 'g' : '') + p.id}
        className={ghost ? 'ghost-art' : 'plan-art'}
        opacity={!ghost && movingPlacementIds.includes(p.id) ? 0.15 : undefined}
        onPointerDown={ghost ? undefined : (e) => down(e, p)}
        onContextMenu={
          ghost
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                onObjectContextMenu?.({ type: 'artwork', id: p.id, x: e.clientX, y: e.clientY });
              }
        }
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      >
        <line
          x1={px - (w.tangent.x * a.width) / 2 + (w.normal.x * thick) / 2}
          y1={pz - (w.tangent.z * a.width) / 2 + (w.normal.z * thick) / 2}
          x2={px + (w.tangent.x * a.width) / 2 + (w.normal.x * thick) / 2}
          y2={pz + (w.tangent.z * a.width) / 2 + (w.normal.z * thick) / 2}
          stroke={ghost ? '#ab7cba' : selectedArt ? '#bd8b49' : '#4f7062'}
          strokeWidth={thick}
          strokeDasharray={ghost ? '150 100' : undefined}
        />
        {!ghost && (
          <line
            x1={px - (w.tangent.x * a.width) / 2}
            y1={pz - (w.tangent.z * a.width) / 2}
            x2={px + (w.tangent.x * a.width) / 2}
            y2={pz + (w.tangent.z * a.width) / 2}
            stroke="transparent"
            strokeWidth={1000}
          >
            <title>
              {a.title} · 中心 {format(p.s)} mm · 下端 {format(p.bottom)} mm
            </title>
          </line>
        )}
        {!ghost && !mini && labelSettings?.enabled && (
          <text
            className="plan-artwork-label"
            data-artwork-label={p.id}
            x={px + w.normal.x * 1100}
            y={pz + w.normal.z * 1100}
            textAnchor={w.normal.x < 0 ? 'end' : 'start'}
          >
            {artworkLabelRows(a, labelSettings).map((row, index) => (
              <tspan
                key={row.key}
                data-label-field={row.key}
                x={px + w.normal.x * 1100}
                dy={index ? 480 : 0}
              >
                {`${row.key === 'title' ? '' : row.label + '：'}${row.value}`.slice(0, 80)}
                {row.value.length > 80 ? '…' : ''}
              </tspan>
            ))}
          </text>
        )}
      </g>
    );
  };
  const part = (p, ghost = false, preview = false) => {
    const g = partitionGeometry(p, project.rails);
    const color = preview
      ? partitionPreview.valid
        ? '#468950'
        : '#d14935'
      : ghost
        ? '#ab7cba'
        : selectedPartition === p.id
          ? '#b68246'
          : '#697f5b';
    const coords = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
      .map(
        ([s, n]) =>
          `${g.x + ((g.tangent.x * p.width) / 2) * s + ((g.normal.x * p.thickness) / 2) * n},${g.z + ((g.tangent.z * p.width) / 2) * s + ((g.normal.z * p.thickness) / 2) * n}`,
      )
      .join(' ');
    return (
      <g
        key={(ghost ? 'g' : '') + p.id}
        className={preview ? 'plan-partition-preview' : ghost ? 'ghost-part' : 'plan-partition'}
        data-partition-id={ghost || preview ? undefined : p.id}
        pointerEvents={preview ? 'none' : undefined}
        onPointerDown={ghost || preview ? undefined : (e) => downPart(e, p)}
        onContextMenu={
          ghost || preview
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                onObjectContextMenu?.({ type: 'partition', id: p.id, x: e.clientX, y: e.clientY });
              }
        }
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <polygon
          points={coords}
          fill={
            preview ? color : ghost ? 'none' : selectedPartition === p.id ? '#cfa772' : '#e6e7db'
          }
          fillOpacity={preview ? 0.35 : undefined}
          stroke={color}
          strokeWidth={mini ? 100 : 65}
          strokeDasharray={ghost || preview ? '180 100' : undefined}
        />
        {!ghost && !preview && (
          <line
            x1={g.x - (g.tangent.x * p.width) / 2}
            y1={g.z - (g.tangent.z * p.width) / 2}
            x2={g.x + (g.tangent.x * p.width) / 2}
            y2={g.z + (g.tangent.z * p.width) / 2}
            stroke="transparent"
            strokeWidth={mini ? 900 : 800}
          >
            <title>
              {p.name} · {format(p.width)} × {format(p.height)} × {format(p.thickness)} mm
            </title>
          </line>
        )}
      </g>
    );
  };
  const steel = (f, ghost = false) => {
    const { shape, nodes } = frameGeometry(f, project),
      color = ghost ? '#ab7cba' : selectedSteelFrame === f.id ? '#b68246' : '#637e88';
    return (
      <g
        key={`${ghost ? 'ghost-' : ''}${f.id}`}
        className="plan-steel-frame"
        data-steel-frame-id={ghost ? undefined : f.id}
        onPointerDown={ghost ? undefined : (e) => steelDown(e, f)}
        onContextMenu={
          ghost
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                onObjectContextMenu?.({
                  type: 'steel-frame',
                  id: f.id,
                  x: e.clientX,
                  y: e.clientY,
                });
              }
        }
        onPointerMove={steelMove}
        onPointerUp={steelUp}
        onPointerCancel={steelUp}
        onLostPointerCapture={steelUp}
      >
        <title>
          {f.name} ·{' '}
          {f.kind === 'line'
            ? format(Math.hypot(...f.lineEnd))
            : `${format(f.width)} × ${format(f.height)}`}{' '}
          mm
        </title>
        {!ghost &&
          f.membrane.faces.map((index) => (
            <polygon
              key={`face-${index}`}
              data-steel-membrane-face={index}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onObjectContextMenu?.({
                  type: 'steel-membrane',
                  id: f.id,
                  faceIndex: index,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              points={shape.faces[index].nodes
                .map((i) => `${nodes[i][0]},${nodes[i][2]}`)
                .join(' ')}
              fill={f.membrane.color}
              fillOpacity={f.membrane.opacity}
              stroke="none"
            />
          ))}
        {shape.members.map(([a, b], i) => (
          <g key={i}>
            <line
              x1={nodes[a][0]}
              y1={nodes[a][2]}
              x2={nodes[b][0]}
              y2={nodes[b][2]}
              stroke={color}
              strokeWidth={mini ? 110 : 65}
              strokeDasharray={ghost ? '180 100' : undefined}
            />
            {!ghost && (
              <line
                x1={nodes[a][0]}
                y1={nodes[a][2]}
                x2={nodes[b][0]}
                y2={nodes[b][2]}
                stroke="transparent"
                strokeWidth={mini ? 500 : 380}
              />
            )}
          </g>
        ))}
      </g>
    );
  };
  const lineFace = (face, source, ghost = false) => {
    const membrane = source.steelLineMembranes?.find((m) => m.faceId === face.id);
    const path = [face, ...face.holes]
      .map((loop) => `M${loop.points.map((p) => `${p[0]},${p[2]}`).join('L')}Z`)
      .join(' ');
    return (
      <path
        key={`${ghost ? 'ghost-' : ''}${face.id}`}
        data-steel-line-face-id={ghost ? undefined : face.id}
        d={path}
        fillRule="evenodd"
        fill={ghost ? 'none' : membrane?.color || '#a4bdaf'}
        fillOpacity={membrane?.opacity ?? 0.05}
        stroke={ghost ? '#ab7cba' : selectedSteelLineFace === face.id ? '#b68246' : '#799b8b'}
        strokeWidth={mini ? 70 : 35}
        strokeDasharray={ghost ? '180 100' : undefined}
        onPointerDown={
          ghost
            ? undefined
            : (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onSelectSteelLineFace?.(face.id);
              }
        }
        onContextMenu={
          ghost
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                onObjectContextMenu?.(
                  membrane
                    ? { type: 'steel-line-face', id: face.id, x: e.clientX, y: e.clientY }
                    : null,
                );
              }
        }
      >
        <title>{face.name}</title>
      </path>
    );
  };
  return (
    <svg
      data-placing={String(!!(placingArtworkId || movingPlacementId || placingPartition) && !mini)}
      data-placing-partition={String(placingPartition && !mini)}
      data-partition-preview-rail={partitionPreview?.partition?.railId || ''}
      data-partition-preview-s={partitionPreview?.partition?.s ?? ''}
      data-partition-preview-valid={String(partitionPreview?.valid === true)}
      data-camera-x={camera?.x}
      data-camera-z={camera?.z}
      ref={svg}
      className={mini ? 'plan-svg mini' : 'plan-svg'}
      viewBox={`${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}`}
      role="img"
      aria-label={mini ? '現在地ミニマップ' : '寸法付き展示平面図'}
      onPointerMoveCapture={(e) => {
        if (placingPartition && !mini) {
          e.stopPropagation();
          pointerPartitionPreview(e);
          return;
        }
        if (!placingArtworkId || mini) return;
        e.stopPropagation();
        pointerPreview(e);
      }}
      onPointerDownCapture={(e) => {
        if (placingPartition && !mini && e.button === 0) {
          e.stopPropagation();
          e.preventDefault();
          const result = pointerPartitionPreview(e);
          if (result.valid) onPlacePartition?.(result.partition);
          else onNotice?.(result.message);
          return;
        }
        if (!placingArtworkId || mini || e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const result = pointerPreview(e);
        if (result?.valid) onPlace?.(result.anchor || result.placement);
      }}
      onPointerLeave={() => {
        if (placingPartition && !mini) onPartitionPreview?.(null);
        if (placingArtworkId && !mini) onPreview?.(null);
      }}
      onPointerDown={(e) => {
        if (e.target === svg.current) onSelect(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onObjectContextMenu?.(null);
      }}
    >
      <defs>
        <pattern
          id={mini ? 'grid-mini' : 'grid-plan'}
          width="1000"
          height="1000"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#cdd4ca" strokeWidth="18" />
        </pattern>
      </defs>
      <polygon
        points={polygon(b)
          .map((p) => p.join(','))
          .join(' ')}
        fill="#f5f5ee"
        stroke="#d6dacf"
        strokeWidth={sw}
      />
      {!mini && (
        <polygon
          points={polygon(b)
            .map((p) => p.join(','))
            .join(' ')}
          fill="url(#grid-plan)"
        />
      )}
      {showRails &&
        !mini &&
        project.rails.map((r) => (
          <line
            className="partition-floor-line"
            data-rail-id={r.id}
            key={r.id}
            x1={r.x1}
            y1={r.z1}
            x2={r.x2}
            y2={r.z2}
            stroke={
              placingPartition && partitionPreview?.partition?.railId === r.id
                ? '#468950'
                : '#8ba879'
            }
            strokeWidth={placingPartition ? '75' : '40'}
            strokeDasharray="180 130"
            opacity=".65"
          >
            <title>{r.name}：可動壁の配置ライン（座標は推定）</title>
          </line>
        ))}
      <rect
        x={-b.columnSize}
        y={b.length - 4970 - b.columnSize}
        width={b.columnSize}
        height={b.columnSize}
        fill="#939d91"
      />
      {ws
        .filter((w) => !w.partitionId)
        .map((w) => (
          <g key={w.id}>
            <line
              x1={w.start.x}
              y1={w.start.z}
              x2={w.end.x}
              y2={w.end.z}
              stroke={w.hangable ? '#4b574c' : '#a7beb6'}
              strokeWidth={mini ? 220 : project.building.wallThickness}
            />
            {!mini &&
              w.hangable &&
              label(
                (w.start.x + w.end.x) / 2 + w.normal.x * 750,
                (w.start.z + w.end.z) / 2 + w.normal.z * 750,
                w.name.split(' · ')[0],
              )}
          </g>
        ))}
      {!mini && showDimensions && (
        <g className="dimension-lines" fill="none" stroke="#9ca795" strokeWidth="24">
          <path
            d={`M0 -650V-1600H${b.mainWidth}V-650 M${x} ${b.length + 700}V${b.length + 1700}H${b.mainWidth}V${b.length + 700} M${b.mainWidth + 650} 0H${b.mainWidth + 1800}V${b.length}H${b.mainWidth + 650}`}
          />
          {label(b.mainWidth / 2, -2000, `${format(b.mainWidth)} mm`)}
          {label((x + b.mainWidth) / 2, b.length + 2500, `${format(b.overallWidth)} mm`)}
          {label(b.mainWidth + 2600, b.length / 2, `${format(b.length)} mm *`, 90)}
        </g>
      )}
      {compare?.partitions.map((p) => part(p, true))}
      {layout.partitions.map((p) => part(p))}
      {compare &&
        detectSteelLineFaces(compare.steelFrames || []).map((face) =>
          lineFace(face, compare, true),
        )}
      {detectSteelLineFaces(layout.steelFrames).map((face) => lineFace(face, layout))}
      {compare?.steelFrames?.map((f) => steel(f, true))}
      {layout.steelFrames?.map((f) => steel(f))}
      {compare?.placements.map((p) => art(p, true))}
      {layout.placements.map((p) => art(p))}
      {!mini &&
        placingPartition &&
        partitionPreview?.partition &&
        part(partitionPreview.partition, false, true)}
      {!mini &&
        (
          placementPreview?.placements ||
          (placementPreview?.placement ? [placementPreview.placement] : [])
        ).map((p) => {
          const a = project.artworks.find((a) => a.id === p.artworkId),
            w = ws.find((w) => w.id === p.wallId);
          if (!a || !w) return null;
          const x = w.start.x + w.tangent.x * p.s + w.normal.x * 140,
            z = w.start.z + w.tangent.z * p.s + w.normal.z * 140;
          return (
            <line
              key={p.id}
              data-preview-placement-id={p.id}
              data-preview-bottom={p.bottom}
              className="plan-placement-preview"
              pointerEvents="none"
              x1={x - (w.tangent.x * a.width) / 2}
              y1={z - (w.tangent.z * a.width) / 2}
              x2={x + (w.tangent.x * a.width) / 2}
              y2={z + (w.tangent.z * a.width) / 2}
              stroke={placementPreview.valid ? '#468950' : '#d14935'}
              strokeWidth="280"
              strokeDasharray="160 80"
            />
          );
        })}
      {camera && (
        <g>
          <circle
            cx={camera.x}
            cy={camera.z}
            r={mini ? 400 : 260}
            fill="#bd8849"
            stroke="#fff"
            strokeWidth="100"
          />
          <circle
            cx={camera.x}
            cy={camera.z}
            r={mini ? 900 : 600}
            fill="none"
            stroke="#bd8849"
            strokeWidth="40"
            opacity=".4"
          />
        </g>
      )}
      {!mini && (
        <g className="plan-north">
          <path
            d={`M${x - 1400} 2200v-1500l-250 400m250-400l250 400`}
            fill="none"
            stroke="#79866e"
            strokeWidth="45"
          />
          {label(x - 1400, 3000, '真北 / N')}
        </g>
      )}
    </svg>
  );
}
