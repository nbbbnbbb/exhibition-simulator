import {
  assertSteelSegmentInside,
  sectionRadius,
  steelSections,
  validateFrame,
} from './steelFrames.js';

export const DEFAULT_STEEL_LINE_SETTINGS = {
  plane: 'xz',
  offset: 1500,
  sectionId: 'c65',
  continuous: true,
};
export const STEEL_LINE_PLANES = [
  { id: 'xz', name: '水平面 XZ', axis: 1, label: '作業面の高さ Y', defaultOffset: 1500 },
  { id: 'xy', name: '垂直面 XY', axis: 2, label: '作業面の位置 Z', defaultOffset: 15000 },
  { id: 'yz', name: '垂直面 YZ', axis: 0, label: '作業面の位置 X', defaultOffset: 4500 },
];
export const steelLineLength = (f) => Math.hypot(...f.lineEnd);
export function steelLineEndpoints(f) {
  return [[f.x, f.y, f.z], f.lineEnd.map((v, i) => v + [f.x, f.y, f.z][i])];
}
export function withSteelLineEndpoints(f, start, end) {
  return { ...f, x: start[0], y: start[1], z: start[2], lineEnd: end.map((v, i) => v - start[i]) };
}
export function newSteelLine(project, start, end, sectionId, id = crypto.randomUUID()) {
  const frame = withSteelLineEndpoints(
    {
      id,
      name: '鉄骨ライン',
      kind: 'line',
      sectionId,
      rotation: 0,
      membrane: { faces: [], color: '#edf4ef', opacity: 0.35 },
    },
    start,
    end,
  );
  return validateFrame(frame, project);
}
// Rays are expressed in millimetres, matching stored endpoints.
export function pointOnSteelPlane(origin, direction, settings, step = 10) {
  const plane = STEEL_LINE_PLANES.find((p) => p.id === settings.plane);
  if (!plane || !Number.isFinite(settings.offset) || Math.abs(direction[plane.axis]) < 1e-7)
    return null;
  const t = (settings.offset - origin[plane.axis]) / direction[plane.axis];
  if (!Number.isFinite(t) || t < 0) return null;
  return origin.map((v, i) =>
    i === plane.axis
      ? Math.round(settings.offset)
      : Math.round((v + direction[i] * t) / step) * step,
  );
}
export function previewSteelLine(project, tool, point, snapped = false) {
  if (!point)
    return { valid: false, point: null, message: '作業面が見えるように視点を回転してください' };
  const section = steelSections(project).find((s) => s.id === tool.sectionId);
  let frame;
  const length = tool.start ? Math.hypot(...point.map((v, i) => v - tool.start[i])) : 0;
  try {
    if (!section || point.length !== 3 || !point.every(Number.isInteger))
      throw new Error('部材断面と座標を確認してください');
    if (tool.start)
      frame = newSteelLine(project, tool.start, point, tool.sectionId, 'steel-line-preview');
    else assertSteelSegmentInside(point, point, project.building, sectionRadius(section));
    return {
      valid: true,
      point,
      snapped,
      length,
      frame,
      message: tool.start ? 'クリックでラインを配置' : 'クリックで始点を指定',
    };
  } catch (error) {
    if (section && tool.start && length > 0)
      frame = withSteelLineEndpoints(
        {
          id: 'steel-line-preview',
          name: 'プレビュー',
          kind: 'line',
          sectionId: tool.sectionId,
          rotation: 0,
          membrane: { faces: [], color: '#edf4ef', opacity: 0.35 },
        },
        tool.start,
        point,
      );
    return { valid: false, point, snapped, length, frame, message: error.message };
  }
}
