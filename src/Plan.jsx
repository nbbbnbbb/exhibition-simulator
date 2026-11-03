import { useRef } from 'react';
import { walls, polygon, fitPlacement, format, fitPartition, partitionGeometry } from './domain.js';
export default function Plan({
  project,
  selected,
  compare,
  onSelect,
  onMove,
  camera,
  showDimensions = true,
  mini = false,
  selectedPartition,
  onSelectPartition,
  onPartitionMove,
  showRails = false,
}) {
  const svg = useRef();
  const drag = useRef();
  const b = project.building,
    layout = project.layouts.find((l) => l.id === project.activeLayoutId),
    ws = walls(b, layout.partitions, project.rails);
  const x = b.mainWidth - b.overallWidth;
  const pad = mini ? 1300 : 3300;
  const sw = mini ? 150 : 70;
  const point = (e) => {
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current.getScreenCTM().inverse());
  };
  const down = (e, p) => {
    e.stopPropagation();
    onSelect(p.id, e.shiftKey || e.ctrlKey || e.metaKey);
    if (mini) return;
    const w = ws.find((w) => w.id === p.wallId);
    drag.current = { p, w, start: point(e) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const downPart = (e, p) => {
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
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const pos = point(e);
    const ds = (pos.x - d.start.x) * d.w.tangent.x + (pos.y - d.start.y) * d.w.tangent.z;
    try {
      d.next =
        d.type === 'partition'
          ? fitPartition({ ...d.p, s: Math.round((d.p.s + ds) / 10) * 10 }, b, project.rails)
          : fitPlacement(
              { ...d.p, s: Math.round((d.p.s + ds) / 10) * 10 },
              project.artworks.find((a) => a.id === d.p.artworkId),
              b,
              layout.partitions,
              project.rails,
            );
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
    drag.current = null;
    e.currentTarget.removeAttribute('transform');
    if (d?.type === 'partition')
      svg.current
        .querySelectorAll('[data-partition-owner]')
        .forEach((el) => el.removeAttribute('transform'));
    if (d?.next) (d.type === 'partition' ? onPartitionMove : onMove)(d.p.id, d.next);
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
        data-partition-owner={ghost ? undefined : w.partitionId}
        key={(ghost ? 'g' : '') + p.id}
        className={ghost ? 'ghost-art' : 'plan-art'}
        onPointerDown={ghost ? undefined : (e) => down(e, p)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
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
      </g>
    );
  };
  const part = (p, ghost = false) => {
    const g = partitionGeometry(p, project.rails);
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
        className={ghost ? 'ghost-part' : 'plan-partition'}
        data-partition-id={p.id}
        onPointerDown={ghost ? undefined : (e) => downPart(e, p)}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <polygon
          points={coords}
          fill={ghost ? 'none' : selectedPartition === p.id ? '#cfa772' : '#e6e7db'}
          stroke={ghost ? '#ab7cba' : selectedPartition === p.id ? '#b68246' : '#697f5b'}
          strokeWidth={mini ? 100 : 65}
          strokeDasharray={ghost ? '180 100' : undefined}
        />
        {!ghost && (
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
  return (
    <svg
      data-camera-x={camera?.x}
      data-camera-z={camera?.z}
      ref={svg}
      className={mini ? 'plan-svg mini' : 'plan-svg'}
      viewBox={`${x - pad} ${-pad} ${b.overallWidth + 2 * pad} ${b.length + 2 * pad}`}
      role="img"
      aria-label={mini ? '現在地ミニマップ' : '寸法付き展示平面図'}
      onPointerDown={(e) => {
        if (e.target === svg.current) onSelect(null);
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
            key={r.id}
            x1={r.x1}
            y1={r.z1}
            x2={r.x2}
            y2={r.z2}
            stroke="#8ba879"
            strokeWidth="40"
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
      {compare?.placements.map((p) => art(p, true))}
      {layout.placements.map((p) => art(p))}
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
          {label(x - 1400, 3000, '図面上端')}
        </g>
      )}
    </svg>
  );
}
