// Context menus use the same visible surfaces as selection. The enlarged steel
// hit volumes take precedence near an edge; a membrane's interior selects only it.
export function pickContextObject(worldHits, artworkHits) {
  const occluder = worldHits.find(({ object }) => {
    const material = object.material;
    return (
      material &&
      material.colorWrite !== false &&
      (!material.transparent || material.opacity >= 0.95)
    );
  });
  const visible = (hit, allowance = 0.002) =>
    !occluder || hit.distance <= occluder.distance + allowance;
  const art = artworkHits.find((h) => h.object.userData.placementId && visible(h));
  const sceneObject = worldHits.find((h) => h.object.userData.sceneObjectId && visible(h));
  const part = worldHits.find((h) => h.object.userData.partitionId && visible(h));
  const steel = worldHits.find((h) => h.object.userData.steelFrameId && visible(h, 0.08));
  const face = worldHits.find(
    (h) =>
      h.object.userData.steelLineMembrane &&
      visible(h) &&
      (!steel || h.distance < steel.distance - 0.08),
  );
  const candidates = [
    sceneObject && {
      hit: sceneObject,
      type: 'scene-object',
      id: sceneObject.object.userData.sceneObjectId,
    },
    art && { hit: art, type: 'artwork', id: art.object.userData.placementId },
    part && { hit: part, type: 'partition', id: part.object.userData.partitionId },
    steel && {
      hit: steel,
      type: steel.object.userData.steelMembrane ? 'steel-membrane' : 'steel-frame',
      id: steel.object.userData.steelFrameId,
      faceIndex: steel.object.userData.steelMembraneFace,
    },
    face && { hit: face, type: 'steel-line-face', id: face.object.userData.steelLineFaceId },
  ]
    .filter(Boolean)
    .sort((a, b) => a.hit.distance - b.hit.distance);
  if (!candidates.length) return null;
  const { hit, ...target } = candidates[0];
  return target;
}
