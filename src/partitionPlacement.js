import { clamp, fitPartition, railGeometry } from './domain.js';

export function pickPartitionRail(rails, point, tolerance) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  let nearest = null;
  for (const rail of rails) {
    const { length, tangent } = railGeometry(rail);
    const s = clamp((point.x - rail.x1) * tangent.x + (point.z - rail.z1) * tangent.z, 0, length);
    const distance = Math.hypot(
      point.x - rail.x1 - tangent.x * s,
      point.z - rail.z1 - tangent.z * s,
    );
    if (distance <= tolerance && (!nearest || distance < nearest.distance))
      nearest = { railId: rail.id, s, distance };
  }
  return nearest;
}

// A preview is transient: only the click handler adds it to the project/history.
export function previewPartition(project, candidate, fine = false) {
  if (
    !candidate ||
    !project.rails.some((r) => r.id === candidate.railId) ||
    !Number.isFinite(candidate.s)
  )
    return { partition: null, valid: false, message: '可動壁の配置ラインを指してください' };
  const step = fine ? 1 : 10;
  const partition = {
    id: 'partition-preview',
    name: '可動壁プレビュー',
    railId: candidate.railId,
    s: Math.round(candidate.s / step) * step,
    width: 3000,
    height: 5000,
    thickness: 200,
  };
  try {
    return {
      partition: fitPartition(partition, project.building, project.rails),
      valid: true,
      message: '',
    };
  } catch (error) {
    return { partition, valid: false, message: error.message };
  }
}
