import * as THREE from 'three';

// A single desktop layer keeps distant artwork legible without adding WebGL draws.
export function createArtworkOverlayPreview(host, camera, surfaces, occluderGroups) {
  const lastView = new THREE.Matrix4();
  const lastProjection = new THREE.Matrix4();
  const origin = new THREE.Vector3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const screen = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const hits = [];
  let canvas, ctx;
  let width = 0;
  let height = 0;
  let dirty = true;
  let active = false;

  function clear() {
    canvas?.remove();
    if (active) {
      for (const { overlay } of surfaces.values()) {
        if (overlay) overlay.visible.value = true;
      }
    }
    active = false;
    dirty = true;
  }

  function draw(settings, selected, moving) {
    if (!settings?.enabled || settings.position !== 'overlay' || !width || !height) {
      if (active) clear();
      return;
    }
    if (
      !dirty &&
      !moving &&
      lastView.equals(camera.matrixWorld) &&
      lastProjection.equals(camera.projectionMatrix)
    )
      return;
    active = true;
    dirty = false;
    lastView.copy(camera.matrixWorld);
    lastProjection.copy(camera.projectionMatrix);
    origin.setFromMatrixPosition(camera.matrixWorld);
    const selectedIds = new Set(selected);
    const minimumSize = Math.min(12, settings.fontSize);
    const candidates = [];
    for (const [id, { group, image, label, overlay }] of surfaces) {
      if (!overlay) continue;
      const threshold = overlay.visible.value ? minimumSize : minimumSize + 1.5;
      overlay.visible.value = true;
      if (!group.visible || !label.summary) continue;
      point.setFromMatrixPosition(image.matrixWorld);
      normal.set(0, 0, 1).transformDirection(image.matrixWorld);
      if (normal.dot(edge.subVectors(origin, point)) <= 0) continue;
      screen.copy(point).project(camera);
      if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || Math.abs(screen.z) > 1) continue;
      const projectedSize = (x, y) => {
        edge.set(x, y, 0).applyMatrix4(image.matrixWorld).project(camera);
        return Math.hypot((edge.x - screen.x) * width, (edge.y - screen.y) * height) / 2;
      };
      if (
        Math.min(projectedSize(0, overlay.textHeight), projectedSize(overlay.textHeight, 0)) >=
        threshold
      )
        continue;
      candidates.push({
        x: ((screen.x + 1) * width) / 2,
        y: ((1 - screen.y) * height) / 2,
        image,
        overlay,
        distance: point.distanceTo(origin),
        selected: selectedIds.has(id),
        text: label.summary,
      });
    }
    if (!candidates.length) {
      canvas?.remove();
      return;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'artwork-overlay-preview';
      canvas.dataset.testid = 'artwork-overlay-preview';
      canvas.setAttribute('aria-hidden', 'true');
      ctx = canvas.getContext('2d');
    }
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.ceil(width * scale);
    const pixelHeight = Math.ceil(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = `600 ${settings.fontSize}px "Yu Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fffdf6';
    ctx.strokeStyle = '#1c211d';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    const blockers = [];
    for (const group of occluderGroups) {
      group.traverseVisible((object) => {
        if (object.isMesh && !object.userData.editorOnly) blockers.push(object);
      });
    }
    candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || a.distance - b.distance);
    const painted = [];
    const metrics = new Map();
    const maxWidth = Math.min(320, width * 0.65);
    const halfHeight = settings.fontSize * 0.7;
    let rays = 0;
    function visiblePoint(image) {
      const face = image.geometry.parameters;
      // A beam can cover the centre of a work while the rest of it is visible.
      const x = face.width * 0.36;
      const y = face.height * 0.36;
      for (const [localX, localY] of [
        [0, 0],
        [0, y],
        [0, -y],
        [-x, 0],
        [x, 0],
      ]) {
        if (rays++ >= 64) return false;
        point.set(localX, localY, 0).applyMatrix4(image.matrixWorld);
        screen.copy(point).project(camera);
        if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || Math.abs(screen.z) > 1) continue;
        ray.set(origin, edge.subVectors(point, origin).normalize());
        ray.far = point.distanceTo(origin) - 0.002;
        hits.length = 0;
        ray.intersectObjects(blockers, false, hits);
        if (!hits.some(isOpaqueHit)) return true;
      }
      return false;
    }
    for (const item of candidates) {
      if (rays >= 64) break;
      if (!metrics.has(item.text)) {
        const text = shorten(item.text, ctx, maxWidth);
        metrics.set(item.text, { text, halfWidth: ctx.measureText(text).width / 2 + 5 });
      }
      const { text, halfWidth } = metrics.get(item.text);
      const overlaps = (x, y) =>
        painted.some(
          (other) =>
            Math.abs(other.x - x) < other.halfWidth + halfWidth &&
            Math.abs(other.y - y) < other.halfHeight + halfHeight,
        );
      if (overlaps(item.x, item.y) || !visiblePoint(item.image)) continue;
      const x = ((screen.x + 1) * width) / 2;
      const y = ((1 - screen.y) * height) / 2;
      if (overlaps(x, y)) continue;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      item.overlay.visible.value = false;
      painted.push({ x, y, halfWidth, halfHeight });
    }
    if (painted.length && !canvas.parentNode) host.appendChild(canvas);
    if (!painted.length) canvas.remove();
  }

  return {
    draw,
    resize(w, h) {
      width = w;
      height = h;
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },
    composite(sceneCanvas) {
      if (!canvas?.parentNode) return sceneCanvas;
      const output = document.createElement('canvas');
      output.width = sceneCanvas.width;
      output.height = sceneCanvas.height;
      const context = output.getContext('2d');
      context.drawImage(sceneCanvas, 0, 0);
      context.drawImage(canvas, 0, 0, output.width, output.height);
      return output;
    },
    dispose: clear,
  };
}

function isOpaqueHit({ object, face }) {
  const material = Array.isArray(object.material)
    ? object.material[face.materialIndex]
    : object.material;
  return (
    material.visible && material.colorWrite && (!material.transparent || material.opacity >= 0.95)
  );
}

function shorten(value, ctx, maxWidth) {
  if (value.length <= 100 && ctx.measureText(value).width <= maxWidth) return value;
  let text = value.slice(0, 100);
  while (text && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text + '…';
}
