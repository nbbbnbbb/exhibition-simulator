import * as THREE from 'three';
import { silhouetteFor } from './sceneObjects.js';

// Coordinates are in metres; the group origin is the object's bottom centre.
export function makeSceneObject(object, selected = false, ghost = false) {
  const group = new THREE.Group();
  group.name = object.name;
  group.userData.sceneObjectId = object.id;
  group.position.set(object.x / 1000, object.y / 1000, object.z / 1000);
  group.rotation.y = (object.rotation * Math.PI) / 180;
  const w = object.width / 1000,
    h = object.height / 1000,
    d = object.depth / 1000;
  const material = new THREE.MeshStandardMaterial({
    color: ghost ? '#ab7cba' : object.color,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    opacity: ghost ? 0.2 : object.opacity,
    transparent: ghost || object.opacity < 1,
    depthWrite: !ghost && object.opacity === 1,
    emissive: selected ? '#282014' : '#000000',
  });
  const add = (geometry, position = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (!ghost) mesh.userData.sceneObjectId = object.id;
    mesh.castShadow = object.opacity >= 0.95 && object.kind !== 'silhouette';
    mesh.receiveShadow = object.kind !== 'silhouette';
    group.add(mesh);
    return mesh;
  };
  if (object.kind === 'silhouette') {
    const s = silhouetteFor(object);
    const shape = new THREE.Shape(
      s.points.map(([x, y]) => new THREE.Vector2((x - s.aspect / 2) * h, (1 - y) * h)),
    );
    add(new THREE.ShapeGeometry(shape));
  } else if (object.kind === 'plane') {
    const mesh = add(new THREE.PlaneGeometry(w, object.orientation === 'horizontal' ? d : h), [
      0,
      object.orientation === 'horizontal' ? 0 : h / 2,
      0,
    ]);
    if (object.orientation === 'horizontal') mesh.rotation.x = -Math.PI / 2;
  } else if (object.kind === 'table') {
    const top = Math.min(0.04, h / 8),
      leg = Math.min(0.06, w / 8, d / 8);
    add(new THREE.BoxGeometry(w, top, d), [0, h - top / 2, 0]);
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        add(new THREE.BoxGeometry(leg, h - top, leg), [
          (x * (w - leg)) / 2,
          (h - top) / 2,
          (z * (d - leg)) / 2,
        ]);
  } else if (object.kind === 'cylinder') {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, h, 48);
    geometry.scale(w, 1, d);
    add(geometry, [0, h / 2, 0]);
  } else if (object.kind === 'sphere') {
    const geometry = new THREE.SphereGeometry(0.5, 40, 24);
    geometry.scale(w, h, d);
    add(geometry, [0, h / 2, 0]);
  } else if (object.kind === 'polygon') {
    const shape = new THREE.Shape(
      object.points.map(([x, z]) => new THREE.Vector2((x - 0.5) * w, -(z - 0.5) * d)),
    );
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    add(geometry);
  } else add(new THREE.BoxGeometry(w, h, d), [0, h / 2, 0]);
  if (selected && !ghost) {
    const helper = new THREE.BoxHelper(group, '#b68246');
    // BoxHelper is defined in the parent's coordinates; convert it to group-local space.
    group.updateMatrixWorld(true);
    helper.geometry.applyMatrix4(group.matrixWorld.clone().invert());
    helper.userData.editorOnly = true;
    helper.raycast = () => {};
    group.add(helper);
  }
  return group;
}
