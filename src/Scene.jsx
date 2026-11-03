import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  walls,
  polygon,
  positionOnWall,
  fitPlacement,
  isWalkable,
  fitPartition,
  partitionGeometry,
} from './domain.js';

const m = (n) => n / 1000;
export const Scene = forwardRef(function Scene(
  {
    project,
    selected,
    compare,
    mode,
    grid,
    details,
    light,
    eye,
    selectedPartition,
    showRails,
    onSelectPartition,
    onPartitionMove,
    onSelect,
    onMove,
    onNotice,
    onCamera,
  },
  ref,
) {
  const host = useRef();
  const engine = useRef();
  const current = useRef();
  current.current = {
    project,
    selected,
    compare,
    mode,
    grid,
    details,
    light,
    eye,
    selectedPartition,
    showRails,
    onSelectPartition,
    onPartitionMove,
    onSelect,
    onMove,
    onNotice,
    onCamera,
  };
  useImperativeHandle(ref, () => ({
    fit() {
      engine.current?.fit();
    },
    walk() {
      engine.current?.startWalk();
    },
    focus(id) {
      const e = engine.current;
      if (!e) return;
      const c = current.current;
      const p = c.project.layouts
        .find((l) => l.id === c.project.activeLayoutId)
        .placements.find((p) => p.id === id);
      const a = c.project.artworks.find((a) => a.id === p?.artworkId),
        w = walls(
          c.project.building,
          c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
          c.project.rails,
        ).find((w) => w.id === p?.wallId);
      if (!a || !w) return;
      const pos = positionOnWall(w, p.s, p.bottom, a);
      const distance = Math.max(3, m(Math.max(a.width, a.height)) * 2);
      e.controls.target.set(m(pos.x), m(pos.y), m(pos.z));
      e.camera.position.set(
        m(pos.x) + w.normal.x * distance,
        m(pos.y),
        m(pos.z) + w.normal.z * distance,
      );
      e.controls.update();
      e.skipFit = true;
    },
    async exportGLB() {
      const e = engine.current;
      if (!e) return;
      try {
        const group = new THREE.Group();
        group.name = 'MA exhibition (metres)';
        group.add(e.world.clone(true), e.artGroup.clone(true));
        const ceiling = e.ceiling.clone(true);
        ceiling.visible = true;
        group.add(ceiling);
        const ui = [];
        group.traverse((o) => {
          if (o.userData.editorOnly) ui.push(o);
        });
        ui.forEach((o) => o.removeFromParent());
        group.updateMatrixWorld(true);
        const result = await new GLTFExporter().parseAsync(group, { binary: true });
        const url = URL.createObjectURL(new Blob([result], { type: 'model/gltf-binary' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'MA-exhibition.glb';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        onNotice('メートル単位のGLBを保存しました。Blender等へ取り込めます');
      } catch (err) {
        onNotice(`GLBを書き出せません：${err.message}`);
      }
    },
    screenshot() {
      const e = engine.current;
      if (!e) return;
      e.renderer.render(e.scene, e.camera);
      const a = document.createElement('a');
      a.download = 'MA-view.png';
      a.href = e.renderer.domElement.toDataURL('image/png');
      a.click();
    },
    async enterVR() {
      const e = engine.current;
      if (!e) return;
      if (!window.isSecureContext) {
        onNotice('VRにはHTTPSまたはlocalhost接続が必要です');
        return;
      }
      try {
        if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr'))) {
          onNotice('この環境ではVRヘッドセットが検出されません。対応ブラウザーで開いてください');
          return;
        }
        const session = await navigator.xr.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['bounded-floor'],
        });
        e.controls.enabled = false;
        e.ceiling.visible = true;
        e.rig.position.copy(e.spawn());
        e.rig.rotation.set(0, 0, 0);
        e.camera.position.set(0, 0, 0);
        e.camera.rotation.set(0, 0, 0);
        await e.renderer.xr.setSession(session);
        session.addEventListener(
          'end',
          () => {
            e.rig.position.set(0, 0, 0);
            e.rig.rotation.set(0, 0, 0);
            if (current.current.mode === 'walk') e.startWalk();
            else e.fit();
            onNotice('VRを終了しました');
          },
          { once: true },
        );
      } catch (err) {
        e.rig.position.set(0, 0, 0);
        e.rig.rotation.set(0, 0, 0);
        e.fit();
        onNotice(`VRを開始できません：${err.message}`);
      }
    },
  }));
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      current.current.onNotice(
        'WebGLを初期化できません。ハードウェアアクセラレーションを確認してください',
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.domElement.setAttribute('aria-label', '展示空間3Dビュー');
    renderer.domElement.setAttribute('data-testid', 'three-canvas');
    renderer.domElement.tabIndex = 0;
    host.current.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dedfda');
    scene.fog = new THREE.Fog('#dedfda', 100, 200);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.03, 250);
    const rig = new THREE.Group();
    rig.add(camera);
    scene.add(rig);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 2;
    controls.maxDistance = 100;
    const hemi = new THREE.HemisphereLight('#fffaf0', '#a3a89f', 2.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff9ee', 2.4);
    sun.position.set(18, 30, 15);
    sun.target.position.set(0, 0, 24);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -35,
      right: 35,
      top: 35,
      bottom: -35,
      near: 1,
      far: 100,
    });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.015;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#e8efff', 1.5);
    fill.position.set(-10, 12, 36);
    scene.add(fill);
    const world = new THREE.Group();
    const ceiling = new THREE.Group();
    const artGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    scene.add(world, ceiling, artGroup, ghostGroup);
    const gridHelper = new THREE.GridHelper(160, 160, '#9daba3', '#c0c8c0');
    gridHelper.position.y = 0.006;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.3;
    scene.add(gridHelper);
    const textures = new Map();
    const loader = new THREE.TextureLoader();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = new Set();
    let drag = null;
    let looking = false;
    let yaw = 0,
      pitch = 0;
    let last = performance.now();
    let walkMode = false;
    let lastCamera = 0;
    let xrLastTurn = 0;
    const e = {
      renderer,
      scene,
      camera,
      rig,
      controls,
      world,
      ceiling,
      artGroup,
      ghostGroup,
      gridHelper,
      textures,
      loader,
      spawn() {
        const c = current.current,
          b = c.project.building,
          parts = c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions;
        for (let z = b.length - 8000; z > 1000; z -= 500)
          if (isWalkable(b.mainWidth / 2, z, b, parts, c.project.rails))
            return new THREE.Vector3(m(b.mainWidth / 2), 0, m(z));
        return new THREE.Vector3(1, 0, 1);
      },
      fit() {
        const b = current.current.project.building;
        rig.position.set(0, 0, 0);
        rig.rotation.set(0, 0, 0);
        camera.position.set(m(b.mainWidth) + 22, 29, m(b.length) + 13);
        controls.target.set(m(b.mainWidth - b.overallWidth) / 4, 0, m(b.length) / 2);
        controls.update();
      },
      startWalk() {
        const b = current.current.project.building;
        rig.position.set(0, 0, 0);
        camera.position.copy(e.spawn());
        camera.position.y = m(current.current.eye);
        yaw = 0;
        pitch = 0;
        camera.rotation.set(0, 0, 0);
        renderer.domElement.focus();
      },
    };
    engine.current = e;
    e.fit();
    const resize = new ResizeObserver(() => {
      const r = host.current?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return;
      renderer.setSize(r.width, r.height);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host.current);
    function cast(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        (-(ev.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
    }
    function down(ev) {
      if (ev.button !== 0) return;
      const c = current.current;
      if (c.mode === 'walk') {
        looking = true;
        renderer.domElement.setPointerCapture(ev.pointerId);
        renderer.domElement.focus();
        return;
      }
      cast(ev);
      const hit = ray
        .intersectObjects(artGroup.children, true)
        .find((h) => h.object.userData.placementId);
      const wallHit = ray
        .intersectObjects(world.children, true)
        .find((h) => h.object.userData.partitionId);
      if (hit && (!wallHit || hit.distance <= wallHit.distance + 0.02)) {
        const id = hit.object.userData.placementId;
        const layout = c.project.layouts.find((l) => l.id === c.project.activeLayoutId);
        const p = layout.placements.find((p) => p.id === id);
        const w = walls(
          c.project.building,
          c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
          c.project.rails,
        ).find((w) => w.id === p.wallId);
        const a = c.project.artworks.find((a) => a.id === p.artworkId);
        c.onSelect(id, ev.shiftKey || ev.ctrlKey || ev.metaKey);
        const plane = new THREE.Plane(
          new THREE.Vector3(w.normal.x, 0, w.normal.z),
          -(w.normal.x * m(w.start.x) + w.normal.z * m(w.start.z)),
        );
        const point = new THREE.Vector3();
        ray.ray.intersectPlane(plane, point);
        drag = {
          id,
          p,
          w,
          a,
          plane,
          start: point.clone(),
          next: p,
          group: artGroup.children.find((g) => g.userData.placementId === id),
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation();
      } else {
        if (!wallHit) return;
        const layout = c.project.layouts.find((l) => l.id === c.project.activeLayoutId),
          p = layout.partitions.find((p) => p.id === wallHit.object.userData.partitionId);
        c.onSelectPartition(p.id);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camera.getWorldDirection(new THREE.Vector3()),
          wallHit.point,
        );
        const start = new THREE.Vector3();
        ray.ray.intersectPlane(plane, start);
        drag = { type: 'partition', id: p.id, p, plane, start, next: p };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation();
      }
    }
    function move(ev) {
      if (looking) {
        yaw -= ev.movementX * 0.003;
        pitch = THREE.MathUtils.clamp(pitch - ev.movementY * 0.003, -1.25, 1.25);
        return;
      }
      if (!drag) return;
      cast(ev);
      const point = new THREE.Vector3();
      if (!ray.ray.intersectPlane(drag.plane, point)) return;
      if (drag.type === 'partition') {
        const c = current.current,
          g = partitionGeometry(drag.p, c.project.rails);
        const ds =
          (point.x - drag.start.x) * g.tangent.x * 1000 +
          (point.z - drag.start.z) * g.tangent.z * 1000;
        try {
          const next = fitPartition(
            { ...drag.p, s: Math.round((drag.p.s + ds) / 10) * 10 },
            c.project.building,
            c.project.rails,
          );
          drag.next = next;
          const ng = partitionGeometry(next, c.project.rails),
            dx = m(ng.x - g.x),
            dz = m(ng.z - g.z);
          const mesh = world.children.find((o) => o.userData.partitionId === next.id);
          if (mesh) {
            mesh.position.x = m(ng.x);
            mesh.position.z = m(ng.z);
          }
          const layout = c.project.layouts.find((l) => l.id === c.project.activeLayoutId),
            ws = walls(c.project.building, layout.partitions, c.project.rails);
          for (const p of layout.placements.filter((p) =>
            p.wallId.startsWith(`partition:${next.id}:`),
          )) {
            const art = c.project.artworks.find((a) => a.id === p.artworkId),
              w = ws.find((w) => w.id === p.wallId),
              pos = positionOnWall(w, p.s, p.bottom, art),
              group = artGroup.children.find((o) => o.userData.placementId === p.id);
            group?.position.set(m(pos.x) + dx, m(pos.y), m(pos.z) + dz);
          }
        } catch {}
        return;
      }
      const ds =
        (point.x - drag.start.x) * drag.w.tangent.x * 1000 +
        (point.z - drag.start.z) * drag.w.tangent.z * 1000;
      const snap = ev.altKey ? 1 : 10;
      const p = fitPlacement(
        {
          ...drag.p,
          s: Math.round((drag.p.s + ds) / snap) * snap,
          bottom: Math.round((drag.p.bottom + (point.y - drag.start.y) * 1000) / snap) * snap,
        },
        drag.a,
        current.current.project.building,
        current.current.project.layouts.find((l) => l.id === current.current.project.activeLayoutId)
          .partitions,
        current.current.project.rails,
      );
      drag.next = p;
      const pos = positionOnWall(drag.w, p.s, p.bottom, drag.a);
      const group = artGroup.children.find((g) => g.userData.placementId === drag.id);
      group?.position.set(m(pos.x), m(pos.y), m(pos.z));
    }
    function up() {
      looking = false;
      if (drag) {
        const d = drag;
        drag = null;
        controls.enabled = true;
        if (d.next.s !== d.p.s || d.next.bottom !== d.p.bottom)
          (d.type === 'partition' ? current.current.onPartitionMove : current.current.onMove)(
            d.id,
            d.next,
          );
      }
    }
    const keydown = (ev) => {
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName) ||
        ev.target.isContentEditable
      )
        return;
      keys.add(ev.code);
      if (
        current.current.mode === 'walk' &&
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
        ].includes(ev.code)
      )
        ev.preventDefault();
    };
    const keyup = (ev) => keys.delete(ev.code);
    const blur = () => {
      keys.clear();
      looking = false;
    };
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    // Controller rays intersect the floor; releasing a trigger teleports the floor-level rig.
    const teleportMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 40),
      new THREE.MeshBasicMaterial({ color: '#c28848', side: THREE.DoubleSide }),
    );
    teleportMarker.rotation.x = -Math.PI / 2;
    teleportMarker.visible = false;
    teleportMarker.position.y = 0.02;
    scene.add(teleportMarker);
    const controllers = [0, 1].map((i) => {
      const ctrl = renderer.xr.getController(i);
      rig.add(ctrl);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(0, 0, -8),
        ]),
        new THREE.LineBasicMaterial({ color: '#bc9458' }),
      );
      ctrl.add(line);
      ctrl.addEventListener('selectstart', () => (ctrl.userData.selecting = true));
      ctrl.addEventListener('selectend', () => {
        if (ctrl.userData.target) {
          const head = new THREE.Vector3();
          renderer.xr.getCamera().getWorldPosition(head);
          rig.position.x += ctrl.userData.target.x - head.x;
          rig.position.z += ctrl.userData.target.z - head.z;
        }
        ctrl.userData.selecting = false;
      });
      return ctrl;
    });
    renderer.setAnimationLoop((time) => {
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      const c = current.current;
      hemi.intensity = 2.4 * c.light;
      sun.intensity = 2.3 * c.light;
      fill.intensity = 1.3 * c.light;
      gridHelper.visible = c.grid && c.mode !== 'walk' && !renderer.xr.isPresenting;
      if (renderer.xr.isPresenting) {
        ceiling.visible = true;
        teleportMarker.visible = false;
        for (const ctrl of controllers) {
          ctrl.userData.target = null;
          if (ctrl.userData.selecting) {
            ctrl.updateWorldMatrix(true, false);
            const origin = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
            const dir = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld);
            if (dir.y < -0.08) {
              const t = -origin.y / dir.y;
              const target = origin.addScaledVector(dir, t);
              if (
                t < 30 &&
                isWalkable(
                  target.x * 1000,
                  target.z * 1000,
                  c.project.building,
                  c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
                  c.project.rails,
                )
              ) {
                ctrl.userData.target = target;
                teleportMarker.position.set(target.x, 0.02, target.z);
                teleportMarker.visible = true;
              }
            }
          }
        }
        const session = renderer.xr.getSession();
        for (const source of session.inputSources) {
          const axes = source.gamepad?.axes;
          if (!axes) continue;
          const x = axes.length > 2 ? axes[2] : axes[0],
            z = axes.length > 3 ? axes[3] : axes[1];
          if (source.handedness === 'right' && Math.abs(x) > 0.65 && time - xrLastTurn > 350) {
            const viewer = new THREE.Vector3();
            renderer.xr.getCamera().getWorldPosition(viewer);
            const turn = (-Math.sign(x) * Math.PI) / 6;
            const local = viewer.clone().sub(rig.position);
            local.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
            rig.position.copy(viewer.sub(local));
            rig.rotation.y += turn;
            xrLastTurn = time;
          }
          if (source.handedness === 'left' && Math.abs(z) > 0.2) {
            const dir = new THREE.Vector3();
            renderer.xr.getCamera().getWorldDirection(dir);
            dir.y = 0;
            dir.normalize().multiplyScalar(-z * dt * 1.3);
            const next = rig.position.clone().add(dir);
            const head = new THREE.Vector3();
            renderer.xr.getCamera().getWorldPosition(head);
            if (
              isWalkable(
                (head.x + dir.x) * 1000,
                (head.z + dir.z) * 1000,
                c.project.building,
                c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
                c.project.rails,
              )
            ) {
              rig.position.x = next.x;
              rig.position.z = next.z;
            }
          }
        }
      } else {
        teleportMarker.visible = false;
        ceiling.visible = c.mode === 'walk';
        if (c.mode === 'walk') {
          if (!walkMode) e.startWalk();
          controls.enabled = false;
          if (keys.has('ArrowLeft')) yaw += dt * 1.3;
          if (keys.has('ArrowRight')) yaw -= dt * 1.3;
          camera.rotation.set(pitch, yaw, 0, 'YXZ');
          camera.position.y = m(c.eye);
          const forward =
            Number(keys.has('KeyW') || keys.has('ArrowUp')) -
            Number(keys.has('KeyS') || keys.has('ArrowDown'));
          const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
          const speed = (keys.has('ShiftLeft') ? 2.6 : 1.3) * dt;
          const denom = Math.max(1, Math.hypot(forward, right));
          const dx = ((-Math.sin(yaw) * forward + Math.cos(yaw) * right) * speed) / denom,
            dz = ((-Math.cos(yaw) * forward - Math.sin(yaw) * right) * speed) / denom;
          if (
            isWalkable(
              (camera.position.x + dx) * 1000,
              camera.position.z * 1000,
              c.project.building,
              c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
              c.project.rails,
            )
          )
            camera.position.x += dx;
          if (
            isWalkable(
              camera.position.x * 1000,
              (camera.position.z + dz) * 1000,
              c.project.building,
              c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
              c.project.rails,
            )
          )
            camera.position.z += dz;
        } else {
          if (walkMode && !e.skipFit) e.fit();
          e.skipFit = false;
          controls.enabled = !drag;
          controls.update();
        }
        walkMode = c.mode === 'walk';
      }
      renderer.render(scene, camera);
      if (time - lastCamera > 250) {
        lastCamera = time;
        const pos = new THREE.Vector3();
        (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(pos);
        c.onCamera?.({ x: Math.round(pos.x * 1000), z: Math.round(pos.z * 1000) });
      }
    });
    return () => {
      resize.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', down, true);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose();
        }
      });
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const clear = (g) => {
      while (g.children.length) {
        const o = g.children[0];
        o.traverse((n) => {
          n.geometry?.dispose();
          if (n.material)
            for (const mat of Array.isArray(n.material) ? n.material : [n.material]) mat.dispose();
        });
        g.remove(o);
      }
    };
    clear(e.world);
    clear(e.ceiling);
    clear(e.artGroup);
    clear(e.ghostGroup);
    const used = new Set(project.artworks.map((a) => a.image));
    for (const [key, texture] of e.textures)
      if (!used.has(key)) {
        texture.dispose();
        e.textures.delete(key);
      }
    const b = project.building;
    const layout = project.layouts.find((l) => l.id === project.activeLayoutId);
    const ws = walls(b, layout.partitions, project.rails);
    const material = (color, options = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.86, ...options });
    const box = (g, w, h, d, x, y, z, color) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(m(w), m(h), m(d)), material(color));
      mesh.position.set(m(x), m(y), m(z));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const shape = new THREE.Shape();
    polygon(b).forEach(([x, z], i) => (i ? shape.lineTo(m(x), -m(z)) : shape.moveTo(m(x), -m(z))));
    shape.closePath();
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), material('#d7d6cf'));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    e.world.add(floor);
    const ceiling = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      material('#efefea', { side: THREE.DoubleSide }),
    );
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = m(b.height);
    e.ceiling.add(ceiling);
    for (const w of ws.filter((w) => !w.partitionId)) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(m(w.length), m(b.height)),
        material(
          w.hangable ? '#f7f6ef' : '#b5c4c3',
          w.hangable ? {} : { transparent: true, opacity: 0.22, metalness: 0.15 },
        ),
      );
      mesh.position.set(
        m((w.start.x + w.end.x) / 2),
        m(b.height / 2),
        m((w.start.z + w.end.z) / 2),
      );
      mesh.rotation.y = Math.atan2(w.normal.x, w.normal.z);
      mesh.receiveShadow = true;
      e.world.add(mesh);
      const skirting = new THREE.Mesh(
        new THREE.PlaneGeometry(m(w.length), 0.045),
        material('#8b9290'),
      );
      skirting.position.copy(mesh.position);
      skirting.position.y = 0.025;
      skirting.position.x += w.normal.x * 0.003;
      skirting.position.z += w.normal.z * 0.003;
      skirting.rotation.copy(mesh.rotation);
      e.world.add(skirting);
      if (!w.hangable) {
        for (let s = 0; s <= w.length; s += 1120) {
          box(
            e.world,
            45,
            b.height,
            45,
            w.start.x + w.tangent.x * s,
            b.height / 2,
            w.start.z + w.tangent.z * s,
            '#65716d',
          );
        }
        box(e.world, b.mainWidth, 65, 60, b.mainWidth / 2, 2400, w.start.z, '#65716d');
      }
    }
    if (showRails)
      for (const r of project.rails) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(m(r.x1), 0.015, m(r.z1)),
            new THREE.Vector3(m(r.x2), 0.015, m(r.z2)),
          ]),
          new THREE.LineDashedMaterial({
            color: '#718a62',
            dashSize: 0.25,
            gapSize: 0.18,
            transparent: true,
            opacity: 0.6,
          }),
        );
        line.computeLineDistances();
        line.userData.editorOnly = true;
        e.world.add(line);
      }
    for (const p of layout.partitions) {
      const g = partitionGeometry(p, project.rails);
      const mesh = box(e.world, p.width, p.height, p.thickness, g.x, p.height / 2, g.z, '#eeeede');
      mesh.rotation.y = g.rotation;
      mesh.userData.partitionId = p.id;
      mesh.name = p.name;
      if (selectedPartition === p.id) {
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ color: '#b68241' }),
        );
        outline.userData.editorOnly = true;
        mesh.add(outline);
      }
    }
    for (const p of compare?.partitions || []) {
      const g = partitionGeometry(p, project.rails);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(m(p.width), m(p.height), m(p.thickness))),
        new THREE.LineBasicMaterial({ color: '#b17bc4', transparent: true, opacity: 0.6 }),
      );
      outline.position.set(m(g.x), m(p.height / 2), m(g.z));
      outline.rotation.y = g.rotation;
      e.ghostGroup.add(outline);
    }
    // The structural details below are explicitly estimated, not surveyed dimensions.
    if (details) {
      for (let z = 1300; z < b.length - 500; z += b.beamPitch) {
        box(
          e.world,
          b.mainWidth,
          b.beamDepth,
          b.beamWidth,
          b.mainWidth / 2,
          b.height - b.beamDepth / 2,
          z,
          '#a0a399',
        );
        if (Math.round(z / b.beamPitch) % 2 === 0) {
          box(
            e.world,
            b.mainWidth,
            220,
            130,
            b.mainWidth / 2,
            b.height - b.beamDepth - 100,
            z,
            '#747e79',
          );
          box(
            e.world,
            b.mainWidth,
            30,
            270,
            b.mainWidth / 2,
            b.height - b.beamDepth - 200,
            z,
            '#85918a',
          );
        }
      }
      for (const x of [b.mainWidth * 0.25, b.mainWidth * 0.75]) {
        box(e.world, 65, 85, b.length, x, b.height - b.beamDepth - 90, b.length / 2, '#b9bbb0');
        for (let z = 2000; z < b.length - 500; z += b.beamPitch) {
          const fixture = box(
            e.world,
            110,
            160,
            130,
            x,
            b.height - b.beamDepth - 180,
            z,
            '#e9e9df',
          );
          const lens = new THREE.Mesh(
            new THREE.CircleGeometry(0.045, 12),
            new THREE.MeshBasicMaterial({ color: '#fff7df' }),
          );
          lens.rotation.x = -Math.PI / 2;
          lens.position.copy(fixture.position);
          lens.position.y -= 0.081;
          e.world.add(lens);
        }
      }
      box(e.world, 160, 180, b.length, b.mainWidth / 2, b.height - 130, b.length / 2, '#8c9690');
      const west = b.mainWidth - b.overallWidth,
        junction = b.length - b.wingDepth;
      box(
        e.world,
        -west,
        280,
        b.wingDepth - 4970,
        west / 2,
        b.mezzanineHeight,
        junction + (b.wingDepth - 4970) / 2,
        '#b3b4a8',
      );
      box(
        e.world,
        b.mainWidth,
        280,
        3650,
        b.mainWidth / 2,
        b.mezzanineHeight,
        b.length - 4970 - 3650 / 2,
        '#b3b4a8',
      );
      for (let x = west; x < b.mainWidth; x += 220)
        box(e.world, 30, 950, 30, x, b.mezzanineHeight + 615, b.length - 4970 - 3650, '#9baba1');
      box(
        e.world,
        b.overallWidth,
        55,
        55,
        (b.mainWidth + west) / 2,
        b.mezzanineHeight + 1100,
        b.length - 4970 - 3650,
        '#8d9b94',
      );
      for (let z = junction; z < b.length - 4970; z += 220)
        box(e.world, 30, 950, 30, 0, b.mezzanineHeight + 615, z, '#9baba1');
    }
    box(
      e.world,
      b.columnSize,
      b.height,
      b.columnSize,
      -b.columnSize / 2,
      b.height / 2,
      b.length - 4970 - b.columnSize / 2,
      '#b2b3a6',
    );
    function artMesh(p, ghost = false, wallList = ws) {
      const a = project.artworks.find((a) => a.id === p.artworkId),
        w = wallList.find((w) => w.id === p.wallId);
      if (!a || !w) return;
      const g = new THREE.Group(),
        pos = positionOnWall(w, p.s, p.bottom, a);
      g.position.set(m(pos.x), m(pos.y), m(pos.z));
      g.rotation.y = pos.rotation;
      g.userData.placementId = p.id;
      if (ghost) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(m(a.width), m(a.height), m(a.depth))),
          new THREE.LineBasicMaterial({ color: '#b17bc4', transparent: true, opacity: 0.6 }),
        );
        g.add(edges);
        e.ghostGroup.add(g);
        return;
      }
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(m(a.width), m(a.height), m(a.depth)),
        material('#514b3e'),
      );
      frame.userData.placementId = p.id;
      frame.castShadow = true;
      g.add(frame);
      let tex = e.textures.get(a.image);
      if (!tex) {
        tex = e.loader.load(a.image);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, e.renderer.capabilities.getMaxAnisotropy());
        e.textures.set(a.image, tex);
      }
      const image = new THREE.Mesh(
        new THREE.PlaneGeometry(m(a.width - 8), m(a.height - 8)),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      );
      image.position.z = m(a.depth / 2) + 0.001;
      image.userData.placementId = p.id;
      g.add(image);
      if (selected.includes(p.id)) {
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(
            new THREE.BoxGeometry(m(a.width + 30), m(a.height + 30), m(a.depth + 8)),
          ),
          new THREE.LineBasicMaterial({ color: '#b68241' }),
        );
        edge.userData.editorOnly = true;
        g.add(edge);
      }
      e.artGroup.add(g);
    }
    layout.placements.forEach((p) => artMesh(p));
    const compareWalls = compare ? walls(b, compare.partitions, project.rails) : [];
    compare?.placements.forEach((p) => artMesh(p, true, compareWalls));
  }, [project, selected, compare, details, selectedPartition, showRails]);
  return <div className="scene-host" ref={host} />;
});
