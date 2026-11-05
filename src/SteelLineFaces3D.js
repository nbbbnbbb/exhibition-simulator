import * as THREE from 'three';

export function makeSteelLineFace(face, membrane, selected = false, ghost = false) {
  const group = new THREE.Group();
  group.name = membrane ? `ビニール膜 / ${face.name}` : face.name;
  group.userData.steelLineFaceId = face.id;
  if (!membrane || ghost) group.userData.editorOnly = true;
  if (!ghost) {
    const points = [...face.points, ...face.holes.flatMap((h) => h.points)],
      vertices = [];
    const triangles = THREE.ShapeUtils.triangulateShape(
      face.projected.map((p) => new THREE.Vector2(...p)),
      face.holes.map((h) => h.projected.map((p) => new THREE.Vector2(...p))),
    );
    for (const triangle of triangles)
      for (const index of triangle) vertices.push(...points[index].map((x) => x / 1000));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const material = membrane
      ? new THREE.MeshPhysicalMaterial({
          color: membrane.color,
          transparent: true,
          opacity: membrane.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          roughness: 0.22,
          metalness: 0,
          clearcoat: 1,
        })
      : new THREE.MeshBasicMaterial({
          color: '#8bad9d',
          transparent: true,
          opacity: 0.045,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = group.name;
    mesh.userData = { steelLineFaceId: face.id, steelLineMembrane: !!membrane };
    mesh.receiveShadow = !!membrane;
    group.add(mesh);
  }
  for (const loop of [face, ...face.holes]) {
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        loop.points.map((p) => new THREE.Vector3(...p.map((x) => x / 1000))),
      ),
      new THREE.LineBasicMaterial({
        color: ghost ? '#ab7cba' : selected ? '#b68246' : '#719487',
        transparent: true,
        opacity: selected ? 1 : 0.35,
      }),
    );
    outline.userData.editorOnly = true;
    group.add(outline);
  }
  return group;
}
