import * as THREE from 'three';
import { frameGeometry, sectionLoops } from './steelFrames.js';

export function makeSteelFrame(f, project, ghost = false) {
  const { shape, section, local } = frameGeometry(f, project);
  const group = new THREE.Group();
  group.name = f.name;
  group.userData.steelFrameId = f.id;
  group.position.set(f.x / 1000, f.y / 1000, f.z / 1000);
  group.rotation.y = (f.rotation * Math.PI) / 180;
  const loops = sectionLoops(section);
  const outline = new THREE.Shape(loops[0].map(([x, y]) => new THREE.Vector2(x / 1000, y / 1000)));
  for (const hole of loops.slice(1))
    outline.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x / 1000, y / 1000))));
  for (const [a, b] of shape.members) {
    const start = new THREE.Vector3(...local[a]).multiplyScalar(0.001);
    const end = new THREE.Vector3(...local[b]).multiplyScalar(0.001);
    const direction = end.clone().sub(start),
      length = direction.length();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(outline, { depth: length, bevelEnabled: false, steps: 1 }),
      new THREE.MeshStandardMaterial({
        color: ghost ? '#ab7cba' : '#a8b4b8',
        metalness: 0.65,
        roughness: 0.32,
        wireframe: ghost,
        transparent: ghost,
        opacity: ghost ? 0.5 : 1,
      }),
    );
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
    mesh.castShadow = !ghost;
    mesh.receiveShadow = !ghost;
    mesh.userData.steelFrameId = ghost ? undefined : f.id;
    mesh.userData.steelMember = true;
    group.add(mesh);
    if (!ghost) {
      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, length + 0.08),
        new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          transparent: true,
          opacity: 0,
        }),
      );
      pick.position.copy(start.clone().add(end).multiplyScalar(0.5));
      pick.quaternion.copy(mesh.quaternion);
      pick.userData = { steelFrameId: f.id, uiOnly: true };
      group.add(pick);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 25),
        new THREE.LineBasicMaterial({ color: '#d7e3e7', transparent: true, opacity: 0.4 }),
      );
      edge.position.copy(mesh.position);
      edge.quaternion.copy(mesh.quaternion);
      edge.userData.uiOnly = true;
      group.add(edge);
    }
  }
  if (!ghost)
    for (const index of f.membrane.faces) {
      const face = shape.faces[index],
        vertices = [];
      for (let i = 1; i < face.nodes.length - 1; i++)
        for (const n of [face.nodes[0], face.nodes[i], face.nodes[i + 1]])
          vertices.push(...local[n].map((v) => v / 1000));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshPhysicalMaterial({
          color: f.membrane.color,
          transparent: true,
          opacity: f.membrane.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          roughness: 0.22,
          metalness: 0,
          clearcoat: 1,
        }),
      );
      mesh.name = `${f.name} / ビニール膜 / ${face.name}`;
      mesh.userData = { steelFrameId: f.id, steelMembrane: true };
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  return group;
}
