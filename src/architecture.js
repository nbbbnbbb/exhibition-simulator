// Pure millimetre geometry. Partition lines are the source of truth for ceiling carriers.
const mm = (n) => Math.round(Number(n));
export function createRails(b) {
  // Dimensionless line ratios approximate the dotted layout, NOT a 1:100 PDF scale.
  const zs = [0.119, 0.178, 0.294, 0.41, 0.526, 0.642, 0.759].map((r) => mm(b.length * r));
  const x = b.mainWidth - b.overallWidth,
    j = b.length - b.wingDepth;
  return [
    ...zs.map((z, i) => ({
      id: `rail-cross-${i + 1}`,
      name: `主室 横断 ${i + 1}`,
      x1: 0,
      z1: z,
      x2: b.mainWidth,
      z2: z,
      source: '推定：点線の相対位置',
    })),
    {
      id: 'rail-centre',
      name: '主室 中央縦線',
      x1: mm(b.mainWidth / 2),
      z1: zs[0],
      x2: mm(b.mainWidth / 2),
      z2: zs.at(-1),
      source: '推定：点線の相対位置',
    },
    {
      id: 'rail-wing-vertical',
      name: '西室 縦線',
      x1: x + 4500,
      z1: j,
      x2: x + 4500,
      z2: b.length - 5200,
      source: '推定：点線の相対位置',
    },
    {
      id: 'rail-wing-cross',
      name: '西室 横断',
      x1: x,
      z1: j + 4600,
      x2: -600,
      z2: j + 4600,
      source: '推定：点線の相対位置',
    },
    {
      id: 'rail-wing-east',
      name: '接合部 縦線',
      x1: -600,
      z1: j,
      x2: -600,
      z2: b.length - 5200,
      source: '推定：点線の相対位置',
    },
    {
      id: 'rail-south-cross',
      name: '南側 横断',
      x1: -600,
      z1: b.length - 7900,
      x2: b.mainWidth,
      z2: b.length - 7900,
      source: '推定：点線の相対位置',
    },
    {
      id: 'rail-wing-south',
      name: '西室 南側横断',
      x1: x,
      z1: b.length - 5200,
      x2: -600,
      z2: b.length - 5200,
      source: '推定：点線の相対位置',
    },
  ];
}

export function spotTrackLayout(b) {
  const west = b.mainWidth - b.overallWidth,
    j = b.length - b.wingDepth;
  const spines = [
    { id: 'main-left', x: mm(b.mainWidth * 0.25), from: 500, to: b.length - 500 },
    { id: 'main-right', x: mm(b.mainWidth * 0.75), from: 500, to: b.length - 500 },
    { id: 'wing', x: mm(west / 2), from: j + 500, to: b.length - 500 },
  ];
  const tracks = [];
  for (const spine of spines) {
    const bounds = [
      spine.from,
      ...(spine.id === 'wing' ? [b.length - 4970] : [b.length - 8620, b.length - 4970]).filter(
        (z) => z > spine.from && z < spine.to,
      ),
      spine.to,
    ];
    for (let i = 1; i < bounds.length; i++) {
      const z1 = bounds[i - 1],
        z2 = bounds[i],
        mid = (z1 + z2) / 2;
      const low =
        spine.id === 'wing'
          ? mid < b.length - 4970
          : mid > b.length - 8620 && mid < b.length - 4970;
      tracks.push({
        id: `spot-track-${spine.id}-${i}`,
        spineId: spine.id,
        supportId: low ? 'mezzanine-underside' : `concrete-spine-${spine.id}`,
        x: spine.x,
        z1,
        z2,
        y: low ? b.mezzanineHeight - 210 : b.height - b.beamDepth - 70,
        supportY: low ? b.mezzanineHeight - 140 : b.height - b.beamDepth,
        width: 90,
        depth: 55,
      });
    }
  }
  return tracks;
}

export function ceilingStructure(b, rails = createRails(b)) {
  const members = [],
    carriers = [];
  function add(line, kind, width, depth, bottom, color, offset = 0, suffix = '') {
    const dx = line.x2 - line.x1,
      dz = line.z2 - line.z1,
      length = Math.hypot(dx, dz),
      tx = dx / length,
      tz = dz / length;
    members.push({
      id: `${line.id}:${kind}${suffix}`,
      kind,
      railId: line.railId ?? null,
      x: (line.x1 + line.x2) / 2 - tz * offset,
      z: (line.z1 + line.z2) / 2 + tx * offset,
      y: bottom + depth / 2,
      length,
      width,
      depth,
      rotation: Math.atan2(-tz, tx),
      tangent: { x: tx, z: tz },
      color,
    });
  }
  const bottom = b.height - b.beamDepth,
    frame = Math.min(240, b.beamDepth * 0.6),
    flange = Math.min(30, frame * 0.12);
  for (const r of rails) {
    const line = { ...r, id: `carrier-${r.id}`, railId: r.id },
      length = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    carriers.push({ railId: r.id, x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z2, bottom });
    add(line, 'carrier-concrete', b.beamWidth, b.beamDepth - frame, bottom + frame, '#a0a399');
    add(line, 'carrier-top-flange', b.beamWidth * 0.9, flange, bottom + frame - flange, '#7c8884');
    add(line, 'carrier-bottom-flange', b.beamWidth * 0.9, flange, bottom, '#7c8884');
    const steps = Math.max(1, Math.ceil(length / 1200));
    for (let i = 0; i <= steps; i++) {
      const s = 30 + ((length - 60) * i) / steps,
        tx = (r.x2 - r.x1) / length,
        tz = (r.z2 - r.z1) / length;
      const post = {
        ...line,
        x1: r.x1 + tx * (s - 20),
        z1: r.z1 + tz * (s - 20),
        x2: r.x1 + tx * (s + 20),
        z2: r.z1 + tz * (s + 20),
      };
      add(
        post,
        'carrier-post',
        b.beamWidth * 0.45,
        frame - 2 * flange,
        bottom + flange,
        '#7c8884',
        0,
        `-${i}`,
      );
    }
    add(line, 'partition-track', 60, 2, bottom - 2, '#505c58');
  }
  // Retain plain concrete cross beams between rail-bearing beams, using beamPitch as a guide.
  const anchors = [
    ...new Set([
      0,
      ...rails
        .filter(
          (r) => r.z1 === r.z2 && Math.min(r.x1, r.x2) < b.mainWidth && Math.max(r.x1, r.x2) > 0,
        )
        .map((r) => r.z1),
      b.length,
    ]),
  ].sort((a, z) => a - z);
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1],
      z = anchors[i],
      spans = Math.max(1, Math.round((z - a) / b.beamPitch));
    for (let n = 1; n < spans; n++) {
      const position = a + ((z - a) * n) / spans;
      add(
        { id: `concrete-cross-${i}-${n}`, x1: 0, z1: position, x2: b.mainWidth, z2: position },
        'concrete-only-cross',
        b.beamWidth,
        b.beamDepth,
        bottom,
        '#a0a399',
      );
    }
  }
  // These concrete beams carry lighting tracks, not movable-partition rails.
  const west = b.mainWidth - b.overallWidth,
    j = b.length - b.wingDepth;
  for (const spine of [
    { id: 'main-left', x: mm(b.mainWidth * 0.25), z1: 0, z2: b.length },
    { id: 'main-right', x: mm(b.mainWidth * 0.75), z1: 0, z2: b.length },
    { id: 'wing', x: mm(west / 2), z1: j, z2: b.length },
  ])
    add(
      { id: `concrete-spine-${spine.id}`, x1: spine.x, z1: spine.z1, x2: spine.x, z2: spine.z2 },
      'concrete-only-spine',
      b.beamWidth,
      b.beamDepth,
      bottom,
      '#a0a399',
    );
  return { carriers, members, spotTracks: spotTrackLayout(b) };
}

export function structuralBounds(member) {
  const hx =
    (Math.abs(member.tangent.x) * member.length) / 2 +
    (Math.abs(member.tangent.z) * member.width) / 2;
  const hz =
    (Math.abs(member.tangent.z) * member.length) / 2 +
    (Math.abs(member.tangent.x) * member.width) / 2;
  return {
    min: {
      x: (member.x - hx) / 1000,
      y: (member.y - member.depth / 2) / 1000,
      z: (member.z - hz) / 1000,
    },
    max: {
      x: (member.x + hx) / 1000,
      y: (member.y + member.depth / 2) / 1000,
      z: (member.z + hz) / 1000,
    },
  };
}
