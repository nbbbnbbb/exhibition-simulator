import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { LightingRig } from './LightingRig.js';
import { ceilingStructure, glazingFrames } from './architecture.js';
import {
  pickWall,
  previewArtworkAddition,
  artworkBatchDimensions,
  previewMove,
} from './artworkPlacement.js';
import { makeArtworkLabel } from './artworkLabels3D.js';
import { pickContextObject } from './objectPicking.js';
import { pickPartitionRail, previewPartition } from './partitionPlacement.js';
import { makeSteelFrame } from './SteelFrames3D.js';
import { makeSteelLineFace } from './SteelLineFaces3D.js';
import { detectSteelLineFaces } from './steelLineFaces.js';
import { validateFrame, frameGeometry } from './steelFrames.js';
import {
  steelSnapGeometry,
  snapSteelPoint,
  steelOrthogonalConstraint,
  constrainSteelPoint,
} from './steelSnapping.js';
import {
  pointOnSteelPlane,
  previewSteelLine,
  steelLineEndpoints,
  steelLineLength,
  steelPlaneCenter,
} from './steelLinePlacement.js';
import {
  walls,
  polygon,
  positionOnWall,
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
    cutawayRoof,
    eye,
    selectedPartition,
    selectedSteelFrame,
    onSelectSteelFrame,
    onSteelFrameMove,
    selectedSteelLineFace,
    onSelectSteelLineFace,
    steelLineTool,
    steelLinePreview,
    onSteelLinePreview,
    onSteelLinePoint,
    onSteelWorkplaneMove,
    showRails,
    placingPartition,
    partitionPreview,
    onPartitionPreview,
    onPlacePartition,
    onSelectPartition,
    onPartitionMove,
    onSelect,
    onObjectContextMenu,
    onMoveGroup,
    onNotice,
    onCamera,
    placingArtworkId,
    placingArtworkBatch,
    movingPlacementId,
    movingPlacementIds,
    onMoveStart,
    onMoveEnd,
    placementPreview,
    onPreview,
    onPlace,
    labelSettings,
  },
  ref,
) {
  const host = useRef();
  const engine = useRef();
  const current = useRef();
  const snapGeometry = useMemo(() => steelSnapGeometry(project), [project]);
  current.current = {
    snapGeometry,
    project,
    selected,
    compare,
    mode,
    grid,
    details,
    cutawayRoof,
    eye,
    selectedPartition,
    selectedSteelFrame,
    onSelectSteelFrame,
    onSteelFrameMove,
    selectedSteelLineFace,
    onSelectSteelLineFace,
    steelLineTool,
    steelLinePreview,
    onSteelLinePreview,
    onSteelLinePoint,
    onSteelWorkplaneMove,
    showRails,
    placingPartition,
    partitionPreview,
    onPartitionPreview,
    onPlacePartition,
    onSelectPartition,
    onPartitionMove,
    onSelect,
    onObjectContextMenu,
    onMoveGroup,
    onNotice,
    onCamera,
    placingArtworkId,
    placingArtworkBatch,
    movingPlacementId,
    movingPlacementIds,
    onMoveStart,
    onMoveEnd,
    placementPreview,
    onPreview,
    onPlace,
    labelSettings,
  };
  const geometryKey = useMemo(
    () =>
      JSON.stringify([
        project.building,
        project.rails,
        project.artworks,
        project.layouts.find((l) => l.id === project.activeLayoutId)?.placements,
        project.layouts.find((l) => l.id === project.activeLayoutId)?.partitions,
        compare?.placements,
        compare?.partitions,
        project.frameShapes,
        project.steelSections,
        project.layouts.find((l) => l.id === project.activeLayoutId)?.steelFrames,
        compare?.steelFrames,
        project.layouts.find((l) => l.id === project.activeLayoutId)?.steelLineMembranes,
        compare?.steelLineMembranes,
        labelSettings,
      ]),
    [project, compare, labelSettings],
  );
  useImperativeHandle(ref, () => ({
    fit() {
      engine.current?.fit();
    },
    walk() {
      engine.current?.startWalk();
    },
    windowView(side) {
      if (engine.current) engine.current.requestedWindow = side;
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
    focusSteelFrame(id) {
      const e = engine.current,
        c = current.current;
      const f = c.project.layouts
        .find((l) => l.id === c.project.activeLayoutId)
        .steelFrames.find((f) => f.id === id);
      if (!e || !f) return;
      const angle = (f.rotation * Math.PI) / 180,
        distance = Math.max(
          2,
          ((f.kind === 'line' ? steelLineLength(f) : Math.max(f.width, f.height, f.depth)) / 1000) *
            1.7,
        );
      const target =
        f.kind === 'line'
          ? new THREE.Vector3(...steelLineEndpoints(f)[0].map((v, i) => m(v + f.lineEnd[i] / 2)))
          : new THREE.Vector3(m(f.x), m(f.y + f.height / 2), m(f.z));
      e.controls.target.copy(target);
      e.camera.position
        .copy(target)
        .add(
          new THREE.Vector3(
            (f.kind === 'line' ? 0.45 : Math.sin(angle)) * distance,
            distance * (f.kind === 'line' ? 0.5 : 0.25),
            Math.cos(angle) * distance,
          ),
        );
      e.controls.update();
      e.skipFit = true;
    },
    focusSteelWorkplane() {
      const e = engine.current,
        tool = current.current.steelLineTool;
      if (!e || !tool) return;
      const target = new THREE.Vector3(...steelPlaneCenter(tool).map(m));
      const offset =
        tool.plane === 'xy' ? [2, 4, 12] : tool.plane === 'yz' ? [12, 4, 2] : [6, 10, 8];
      e.controls.target.copy(target);
      e.camera.position.copy(target).add(new THREE.Vector3(...offset));
      e.controls.update();
      e.skipFit = true;
    },
    focusSteelLineFace(id) {
      const e = engine.current,
        c = current.current,
        l = c.project.layouts.find((l) => l.id === c.project.activeLayoutId);
      const face = detectSteelLineFaces(l.steelFrames).find((f) => f.id === id);
      if (!e || !face) return;
      const target = new THREE.Vector3(
        ...face.points[0].map(
          (_, i) => face.points.reduce((sum, p) => sum + p[i], 0) / face.points.length / 1000,
        ),
      );
      const distance = Math.max(2, (Math.sqrt(face.area) / 1000) * 1.8);
      e.controls.target.copy(target);
      e.camera.position
        .copy(target)
        .add(new THREE.Vector3(...face.normal).multiplyScalar(distance));
      if (Math.abs(face.normal[1]) < 0.9) e.camera.position.y += distance * 0.25;
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
        const fixtures = new THREE.Group();
        fixtures.name = 'Ceiling light fixtures (estimated)';
        e.lightingRig.group.children
          .filter((o) => o.isMesh)
          .forEach((o) => fixtures.add(o.clone(true)));
        group.add(fixtures);
        const ceiling = e.ceiling.clone(true);
        ceiling.visible = true;
        group.add(ceiling);
        const ui = [];
        group.traverse((o) => {
          if (o.userData.editorOnly || o.userData.uiOnly) ui.push(o);
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
    host.current.dataset.depthPrecision = 'adaptive-near';
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
    const lightingRig = new LightingRig(
      scene,
      renderer,
      current.current.project.building,
      current.current.project.rails,
    );
    const world = new THREE.Group();
    const floorLines = new THREE.Group();
    floorLines.name = '可動壁の床ライン';
    floorLines.userData.editorOnly = true;
    const ceiling = new THREE.Group();
    const artGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    const steelDraftGroup = new THREE.Group();
    const partitionDraftGroup = new THREE.Group();
    partitionDraftGroup.userData.editorOnly = true;
    steelDraftGroup.userData.editorOnly = true;
    const workPlaneGroup = new THREE.Group();
    workPlaneGroup.userData.editorOnly = true;
    workPlaneGroup.visible = false;
    const workPlaneSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({
        color: '#8db8a4',
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    workPlaneSurface.renderOrder = 3;
    workPlaneSurface.name = '仮想の作業平面';
    workPlaneGroup.add(workPlaneSurface);
    const workPlaneOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(workPlaneSurface.geometry),
      new THREE.LineBasicMaterial({
        color: '#4d876c',
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    workPlaneOutline.renderOrder = 4;
    workPlaneGroup.add(workPlaneOutline);
    const workPlaneGrid = new THREE.GridHelper(10, 10, '#638f78', '#9fb9a7');
    workPlaneGrid.material.transparent = true;
    workPlaneGrid.material.opacity = 0.45;
    workPlaneGrid.renderOrder = 4;
    workPlaneGroup.add(workPlaneGrid);
    scene.add(workPlaneGroup);
    const planeControls = new TransformControls(camera, renderer.domElement);
    planeControls.setMode('translate');
    planeControls.setSpace('world');
    planeControls.setSize(0.8);
    planeControls.setTranslationSnap(0.01);
    planeControls.enabled = false;
    const planeHandles = planeControls.getHelper();
    planeHandles.userData.editorOnly = true;
    scene.add(planeHandles);
    planeControls.detach();
    previewGroup.userData.editorOnly = true;
    previewGroup.visible = false;
    scene.add(
      world,
      ceiling,
      artGroup,
      ghostGroup,
      floorLines,
      previewGroup,
      steelDraftGroup,
      partitionDraftGroup,
    );
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
      lightingRig,
      lightBuildingKey: JSON.stringify([
        current.current.project.building,
        current.current.project.rails,
      ]),
      scene,
      camera,
      rig,
      controls,
      world,
      floorLines,
      ceiling,
      artGroup,
      ghostGroup,
      previewGroup,
      steelDraftGroup,
      partitionDraftGroup,
      workPlaneGroup,
      workPlaneSurface,
      workPlaneGrid,
      workPlaneOutline,
      planeControls,
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
        const layout = current.current.project.layouts.find(
          (l) => l.id === current.current.project.activeLayoutId,
        );
        const steelNodes = layout.steelFrames.flatMap(
          (f) => frameGeometry(f, current.current.project).nodes,
        );
        if (
          steelNodes.some(
            ([x, y, z]) =>
              x < b.mainWidth - b.overallWidth ||
              x > b.mainWidth ||
              y < 0 ||
              y > b.height ||
              z < 0 ||
              z > b.length,
          )
        ) {
          const bounds = new THREE.Box3().setFromPoints([
            ...polygon(b).flatMap(([x, z]) => [
              new THREE.Vector3(m(x), 0, m(z)),
              new THREE.Vector3(m(x), m(b.height), m(z)),
            ]),
            ...steelNodes.map((p) => new THREE.Vector3(...p.map(m))),
          ]);
          const target = bounds.getCenter(new THREE.Vector3()),
            size = bounds.getSize(new THREE.Vector3()),
            distance = Math.max(size.x, size.y, size.z) * 1.15;
          controls.maxDistance = Math.max(100, distance * 3);
          camera.far = Math.max(250, distance * 5);
          camera.updateProjectionMatrix();
          controls.target.copy(target);
          camera.position
            .copy(target)
            .add(new THREE.Vector3(0.8, 0.9, 1).normalize().multiplyScalar(distance));
        }
        controls.update();
      },
      startWalk(side) {
        const b = current.current.project.building;
        rig.position.set(0, 0, 0);
        camera.position.copy(e.spawn());
        if (side === 'north') camera.position.set(m(b.mainWidth) / 2, 0, 1.8);
        if (side === 'south') camera.position.set(m(b.mainWidth) / 2, 0, m(b.length) - 1.8);
        camera.position.y = m(current.current.eye);
        yaw = side === 'north' ? Math.PI : 0;
        pitch = 0;
        camera.rotation.set(0, 0, 0);
        renderer.domElement.focus();
      },
    };
    engine.current = e;
    const publishWorkplane = () => {
      const position = workPlaneGroup.position.toArray().map((v) => Math.round(v * 1000));
      host.current.dataset.steelWorkplaneCenter = position.join(',');
      current.current.onSteelWorkplaneMove?.(position);
    };
    function snappingProjection() {
      const rect = renderer.domElement.getBoundingClientRect();
      const project = (point) => {
        const v = new THREE.Vector3(...point.map(m));
        const w = -v.clone().applyMatrix4(camera.matrixWorldInverse).z;
        v.project(camera);
        return {
          x: rect.left + ((v.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - v.y) * rect.height) / 2,
          depth: v.z,
          w,
        };
      };
      project.near = camera.near;
      return project;
    }
    let planeHandleOrigin = null;
    function positionWorkplane(position, constraint = null) {
      const c = current.current;
      const snap = snapSteelPoint(position, c.snapGeometry.steel, snappingProjection(), {
        enabled: c.steelLineTool?.snap !== false,
        constraint,
      });
      workPlaneGroup.position.set(...(snap?.point || position).map(m));
      const preview = snap
        ? { point: snap.point, snapped: true, snapLabel: snap.label, valid: true }
        : null;
      if (JSON.stringify(preview) !== JSON.stringify(c.steelLinePreview))
        c.onSteelLinePreview?.(preview);
      publishWorkplane();
    }
    planeControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value && !drag;
      planeHandleOrigin = event.value
        ? workPlaneGroup.position.toArray().map((v) => Math.round(v * 1000))
        : null;
      host.current.dataset.steelWorkplaneDragging = String(event.value);
    });
    planeControls.addEventListener('objectChange', () => {
      const position = workPlaneGroup.position.toArray().map((v) => Math.round(v * 1000));
      if (e.cancelingPlane || !planeControls.dragging) {
        publishWorkplane();
        return;
      }
      const axes = [0, 1, 2].filter((i) => planeControls.axis?.includes(['X', 'Y', 'Z'][i]));
      positionWorkplane(
        position,
        planeHandleOrigin && axes.length ? { origin: planeHandleOrigin, axes } : null,
      );
    });
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
    function pointerPreview(ev) {
      const c = current.current;
      const moving = drag?.type === 'artwork';
      if (!c.placingArtworkId && !moving) return null;
      e.lastPointer = { clientX: ev.clientX, clientY: ev.clientY, altKey: ev.altKey };
      cast(ev);
      const bounds = renderer.domElement.getBoundingClientRect();
      const inside =
        ev.clientX >= bounds.left &&
        ev.clientX <= bounds.right &&
        ev.clientY >= bounds.top &&
        ev.clientY <= bounds.bottom;
      const target =
        inside &&
        pickWall(
          c.project,
          { x: ray.ray.origin.x * 1000, y: ray.ray.origin.y * 1000, z: ray.ray.origin.z * 1000 },
          ray.ray.direction,
        );
      const art = moving ? drag.a : c.project.artworks.find((a) => a.id === c.placingArtworkId);
      const snap = ev.altKey ? 1 : 10;
      const result =
        target?.wall.hangable && art
          ? moving
            ? previewMove(
                c.project,
                drag.id,
                {
                  wallId: target.wall.id,
                  s:
                    Math.round(
                      (target.s -
                        drag.grabX *
                          (target.wall.normal.z * target.wall.tangent.x -
                            target.wall.normal.x * target.wall.tangent.z)) /
                        snap,
                    ) * snap,
                  bottom: Math.round((target.point.y - art.height / 2 - drag.grabY) / snap) * snap,
                },
                drag.ids,
              )
            : previewArtworkAddition(
                c.project,
                art.id,
                {
                  id: 'preview',
                  wallId: target.wall.id,
                  s: Math.round(target.s / snap) * snap,
                  bottom:
                    Math.round(
                      (target.point.y -
                        artworkBatchDimensions(art, c.placingArtworkBatch).height / 2) /
                        snap,
                    ) * snap,
                },
                c.placingArtworkBatch,
              )
          : {
              placement: null,
              valid: false,
              message: target ? 'ガラス面には配置できません' : '展示可能な壁面を指してください',
            };
      result.source = 'three';
      if (moving) drag.preview = result;
      if (JSON.stringify(result) !== JSON.stringify(c.placementPreview)) c.onPreview?.(result);
      return result;
    }
    function partitionPointer(ev) {
      const c = current.current;
      if (!c.placingPartition) return null;
      cast(ev);
      e.lastPartitionPointer = { clientX: ev.clientX, clientY: ev.clientY, altKey: ev.altKey };
      const rect = renderer.domElement.getBoundingClientRect();
      const floor = new THREE.Vector3();
      let candidate = null;
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), floor)) {
        for (const rail of c.project.rails) {
          const hit = pickPartitionRail([rail], { x: floor.x * 1000, z: floor.z * 1000 }, Infinity);
          if (!hit) continue;
          const g = partitionGeometry({ railId: hit.railId, s: hit.s }, c.project.rails);
          const projected = new THREE.Vector3(m(g.x), 0, m(g.z)).project(camera);
          const distance = Math.hypot(
            ((projected.x - pointer.x) * rect.width) / 2,
            ((projected.y - pointer.y) * rect.height) / 2,
          );
          if (
            projected.z >= -1 &&
            projected.z <= 1 &&
            distance <= 16 &&
            (!candidate || distance < candidate.distance)
          )
            candidate = { ...hit, distance };
        }
      }
      const result = { ...previewPartition(c.project, candidate, ev.altKey), source: 'three' };
      if (JSON.stringify(result) !== JSON.stringify(c.partitionPreview))
        c.onPartitionPreview?.(result);
      return result;
    }
    function steelLinePointer(ev) {
      const c = current.current,
        tool = c.steelLineTool;
      if (!tool || tool.phase !== 'draw') return null;
      cast(ev);
      e.lastSteelPointer = { clientX: ev.clientX, clientY: ev.clientY, altKey: ev.altKey };
      let point = pointOnSteelPlane(
        ray.ray.origin.toArray().map((v) => v * 1000),
        ray.ray.direction.toArray(),
        tool,
        ev.altKey || tool.snap === false ? 1 : 10,
      );
      const constraint = steelOrthogonalConstraint(tool, point);
      const snap =
        tool.orthogonal && tool.start && !point
          ? null
          : snapSteelPoint(
              point || steelPlaneCenter(tool),
              c.snapGeometry.all,
              snappingProjection(),
              {
                cursor: { x: ev.clientX, y: ev.clientY },
                constraint,
                enabled: tool.snap !== false,
              },
            );
      point = snap?.point || constrainSteelPoint(point, constraint);
      const preview = {
        ...previewSteelLine(c.project, tool, point, !!snap),
        snapLabel: snap?.label,
      };
      if (constraint) preview.orthogonalAxis = constraint.axes[0];
      if (JSON.stringify(preview) !== JSON.stringify(c.steelLinePreview))
        c.onSteelLinePreview?.(preview);
      return preview;
    }
    e.refreshSteelPreview = () => {
      if (e.lastSteelPointer && current.current.steelLineTool?.phase === 'draw')
        steelLinePointer(e.lastSteelPointer);
    };
    const cameraChange = () => {
      if (e.lastPartitionPointer && current.current.placingPartition)
        partitionPointer(e.lastPartitionPointer);
      e.refreshSteelPreview();
      if (e.lastPointer && (current.current.placingArtworkId || drag?.type === 'artwork'))
        pointerPreview(e.lastPointer);
    };
    controls.addEventListener('change', cameraChange);
    function contextObject(ev) {
      if (current.current.steelLineTool) return null;
      cast(ev);
      const target = pickContextObject(
        ray.intersectObjects(world.children, true),
        ray.intersectObjects(
          artGroup.children.filter((g) => g.visible),
          true,
        ),
      );
      return target ? { ...target, x: ev.clientX, y: ev.clientY } : null;
    }
    function contextMenu(ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      current.current.onObjectContextMenu?.(contextObject(ev));
    }
    function down(ev) {
      if (ev.button === 2 && contextObject(ev)) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        return;
      }
      if (ev.button !== 0) return;
      const c = current.current;
      if (c.placingPartition) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        renderer.domElement.focus();
        const preview = partitionPointer(ev);
        if (preview?.valid) c.onPlacePartition?.(preview.partition);
        else if (preview?.message) c.onNotice(preview.message);
        return;
      }
      if (c.steelLineTool?.phase === 'plane') {
        renderer.domElement.focus();
        planeControls.setTranslationSnap(
          ev.altKey || c.steelLineTool.snap === false ? 0.001 : 0.01,
        );
        cast(ev);
        // Refresh picking after a camera jump, including clicks without a preceding hover.
        planeHandles.updateMatrixWorld(true);
        planeControls.pointerHover({ x: pointer.x, y: pointer.y, button: ev.button });
        if (planeControls.axis !== null) return;
        const hit = ray.intersectObject(workPlaneSurface)[0];
        if (!hit) return;
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(new THREE.Vector3()),
            hit.point,
          ),
          start = hit.point.clone();
        drag = { type: 'workplane', plane, start, origin: workPlaneGroup.position.clone() };
        controls.enabled = false;
        host.current.dataset.steelWorkplaneDragging = 'true';
        renderer.domElement.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation();
        ev.preventDefault();
        return;
      }
      if (c.steelLineTool) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        renderer.domElement.focus();
        const preview = steelLinePointer(ev);
        if (preview?.valid) c.onSteelLinePoint?.(preview);
        else if (preview?.message) c.onNotice(preview.message);
        return;
      }
      if (c.placingArtworkId) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        const preview = pointerPreview(ev);
        if (preview?.valid) c.onPlace?.(preview.anchor || preview.placement);
        else if (preview?.message) c.onNotice(preview.message);
        return;
      }
      cast(ev);
      const hit = ray
        .intersectObjects(
          artGroup.children.filter((g) => g.visible),
          true,
        )
        .find((h) => h.object.userData.placementId);
      const wallHit = ray
        .intersectObjects(world.children, true)
        .find((h) => h.object.userData.partitionId);
      const occluder = ray.intersectObjects(world.children, true).find((h) => {
        const material = h.object.material;
        return (
          material &&
          material.colorWrite !== false &&
          (!material.transparent || material.opacity >= 0.95)
        );
      });
      const steelHit = ray
        .intersectObjects(world.children, true)
        .find((h) => h.object.userData.steelFrameId);
      const faceHit = ray
        .intersectObjects(world.children, true)
        .find((h) => h.object.userData.steelLineFaceId);
      if (
        c.mode !== 'walk' &&
        faceHit &&
        (!occluder || faceHit.distance <= occluder.distance + 0.002) &&
        (!steelHit || faceHit.distance < steelHit.distance - 0.08) &&
        (!hit || faceHit.distance < hit.distance)
      ) {
        c.onSelectSteelLineFace?.(faceHit.object.userData.steelLineFaceId);
        ev.stopImmediatePropagation();
        return;
      }
      if (
        c.mode !== 'walk' &&
        steelHit &&
        (!occluder || steelHit.distance <= occluder.distance + 0.08) &&
        (!hit || steelHit.distance < hit.distance)
      ) {
        const f = c.project.layouts
          .find((l) => l.id === c.project.activeLayoutId)
          .steelFrames.find((f) => f.id === steelHit.object.userData.steelFrameId);
        c.onSelectSteelFrame?.(f.id);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -steelHit.point.y);
        const start = new THREE.Vector3();
        if (!ray.ray.intersectPlane(plane, start)) return;
        drag = { type: 'steel', id: f.id, p: f, plane, start, next: f };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation();
        return;
      }
      if (hit && (!occluder || hit.distance <= occluder.distance + 0.002)) {
        const id = hit.object.userData.placementId;
        const layout = c.project.layouts.find((l) => l.id === c.project.activeLayoutId);
        const p = layout.placements.find((p) => p.id === id);
        const w = walls(
          c.project.building,
          c.project.layouts.find((l) => l.id === c.project.activeLayoutId).partitions,
          c.project.rails,
        ).find((w) => w.id === p.wallId);
        const a = c.project.artworks.find((a) => a.id === p.artworkId);
        if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
          c.onSelect(id, true);
          ev.stopImmediatePropagation();
          return;
        }
        const ids = c.selected.includes(id) ? [...c.selected] : [id];
        if (!c.selected.includes(id)) c.onSelect(id);
        const plane = new THREE.Plane(
          new THREE.Vector3(w.normal.x, 0, w.normal.z),
          -(w.normal.x * m(w.start.x) + w.normal.z * m(w.start.z)),
        );
        const point = new THREE.Vector3();
        ray.ray.intersectPlane(plane, point);
        drag = {
          type: 'artwork',
          id,
          ids,
          p,
          w,
          a,
          plane,
          start: point.clone(),
          startClient: { x: ev.clientX, y: ev.clientY },
          grabX:
            (hit.point.x * 1000 - w.start.x - w.tangent.x * p.s) * w.normal.z -
            (hit.point.z * 1000 - w.start.z - w.tangent.z * p.s) * w.normal.x,
          grabY: hit.point.y * 1000 - p.bottom - a.height / 2,
          started: false,
          next: p,
          group: artGroup.children.find((g) => g.userData.placementId === id),
        };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation();
      } else {
        if (c.mode === 'walk') {
          looking = true;
          renderer.domElement.setPointerCapture(ev.pointerId);
          renderer.domElement.focus();
          return;
        }
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
      if (current.current.placingPartition) {
        partitionPointer(ev);
        return;
      }
      if (drag?.type === 'workplane') {
        cast(ev);
        const point = new THREE.Vector3();
        if (!ray.ray.intersectPlane(drag.plane, point)) return;
        const step = ev.altKey || current.current.steelLineTool.snap === false ? 1 : 10,
          position = drag.origin.clone().add(point.sub(drag.start));
        positionWorkplane(position.toArray().map((v) => Math.round((v * 1000) / step) * step));
        return;
      }
      if (current.current.steelLineTool?.phase === 'plane') {
        planeControls.setTranslationSnap(
          ev.altKey || current.current.steelLineTool.snap === false ? 0.001 : 0.01,
        );
        host.current.dataset.steelWorkplaneAxis = planeControls.axis || '';
        return;
      }
      if (current.current.steelLineTool) {
        steelLinePointer(ev);
        return;
      }
      if (current.current.placingArtworkId) {
        pointerPreview(ev);
        return;
      }
      if (looking) {
        yaw -= ev.movementX * 0.003;
        pitch = THREE.MathUtils.clamp(pitch - ev.movementY * 0.003, -1.25, 1.25);
        return;
      }
      if (!drag) return;
      if (drag.type === 'artwork') {
        if (!drag.started) {
          if (Math.hypot(ev.clientX - drag.startClient.x, ev.clientY - drag.startClient.y) < 3)
            return;
          drag.started = true;
          current.current.onMoveStart?.(drag.id, drag.ids);
        }
        pointerPreview(ev);
        return;
      }
      renderer.shadowMap.needsUpdate = true;
      cast(ev);
      const point = new THREE.Vector3();
      if (!ray.ray.intersectPlane(drag.plane, point)) return;
      if (drag.type === 'steel') {
        const c = current.current,
          step = ev.altKey ? 1 : 10;
        const next = {
          ...drag.p,
          x: Math.round((drag.p.x + (point.x - drag.start.x) * 1000) / step) * step,
          z: Math.round((drag.p.z + (point.z - drag.start.z) * 1000) / step) * step,
        };
        try {
          validateFrame(next, c.project);
          drag.next = next;
          const group = world.children.find((o) => o.userData.steelFrameId === next.id);
          group?.position.set(m(next.x), m(next.y), m(next.z));
        } catch {}
        return;
      }
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
    }
    function up(ev) {
      looking = false;
      if (drag) {
        const d = drag;
        if (d.type === 'artwork' && d.started && ev?.type === 'pointerup') pointerPreview(ev);
        drag = null;
        controls.enabled = true;
        if (d.type === 'workplane') {
          if (ev?.type !== 'pointerup') {
            workPlaneGroup.position.copy(d.origin);
            current.current.onSteelLinePreview?.(null);
          }
          publishWorkplane();
          host.current.dataset.steelWorkplaneDragging = 'false';
          return;
        }
        if (d.type === 'artwork') {
          if (d.started && ev?.type === 'pointerup') {
            const p = d.preview?.placement;
            if (
              d.preview?.valid &&
              p &&
              (p.wallId !== d.p.wallId || p.s !== d.p.s || p.bottom !== d.p.bottom)
            )
              current.current.onMoveGroup(d.id, p, d.ids);
            else if (!d.preview?.valid)
              current.current.onNotice(d.preview?.message || '移動を取り消しました');
          }
          current.current.onMoveEnd?.();
        } else if (d.type === 'steel') {
          const mesh = world.children.find((o) => o.userData.steelFrameId === d.id);
          mesh?.position.set(m(d.p.x), m(d.p.y), m(d.p.z));
          if (ev?.type === 'pointerup' && (d.next.x !== d.p.x || d.next.z !== d.p.z))
            current.current.onSteelFrameMove?.(d.id, { x: d.next.x, z: d.next.z });
        } else if (ev?.type === 'pointerup' && d.next.s !== d.p.s)
          current.current.onPartitionMove(d.id, d.next);
      }
    }
    e.cancelArtworkDrag = () => {
      if (drag?.type === 'artwork') up();
    };
    e.cancelObjectDrag = () => {
      if (drag?.type === 'artwork' || drag?.type === 'steel' || drag?.type === 'workplane') up();
      if (planeControls.dragging) {
        e.cancelingPlane = true;
        planeControls.reset();
        e.cancelingPlane = false;
        current.current.onSteelLinePreview?.(null);
        planeControls.pointerUp(null);
        controls.enabled = true;
      }
    };
    function leave() {
      e.lastPartitionPointer = null;
      if (current.current.placingPartition) current.current.onPartitionPreview?.(null);
      e.lastSteelPointer = null;
      if (current.current.steelLineTool) current.current.onSteelLinePreview?.(null);
      e.lastPointer = null;
      if (current.current.placingArtworkId) current.current.onPreview?.(null);
    }
    const keydown = (ev) => {
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName) ||
        ev.target.isContentEditable
      )
        return;
      keys.add(ev.code);
      if (ev.code === 'Escape') e.cancelObjectDrag();
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
      e.cancelObjectDrag();
    };
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('contextmenu', contextMenu, true);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    renderer.domElement.addEventListener('lostpointercapture', e.cancelObjectDrag);
    renderer.domElement.addEventListener('pointerleave', leave);
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
      const activeLighting = c.project.layouts.find(
        (l) => l.id === c.project.activeLayoutId,
      ).lighting;
      // Preserve the real mm offsets while improving distant depth resolution.
      // Keep a close clip plane for walk/VR; orbit inspection uses its distance.
      const near =
        renderer.xr.isPresenting || c.mode === 'walk'
          ? 0.03
          : Math.max(0.03, Math.min(0.5, camera.position.distanceTo(controls.target) * 0.005));
      if (Math.abs(camera.near - near) > 0.0001) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      host.current.dataset.cameraNear = String(camera.near);
      const sunStatus = e.lightingRig.update(activeLighting);
      if (sunStatus && host.current) {
        host.current.dataset.sunAltitude = sunStatus.altitude.toFixed(2);
        host.current.dataset.sunAzimuth = sunStatus.azimuth.toFixed(2);
        host.current.dataset.directSunLux = sunStatus.normalLux.toFixed(2);
      }
      ceiling.visible = true;
      const roof = ceiling.children[0];
      if (roof) {
        roof.material.colorWrite = c.mode === 'walk' || renderer.xr.isPresenting || !c.cutawayRoof;
        roof.material.depthWrite = roof.material.colorWrite;
      }
      if (host.current) {
        host.current.dataset.roofOccludes = 'true';
        host.current.dataset.roofCutaway = String(
          c.mode !== 'walk' && !renderer.xr.isPresenting && c.cutawayRoof,
        );
      }
      gridHelper.visible = c.grid && c.mode !== 'walk' && !renderer.xr.isPresenting;
      floorLines.visible = c.showRails;
      if (host.current) {
        host.current.dataset.floorLines = String(c.showRails);
        host.current.dataset.floorLineCount = String(c.showRails ? floorLines.children.length : 0);
      }
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
        ceiling.visible = true;
        if (c.mode === 'walk') {
          if (!walkMode || e.requestedWindow) {
            e.startWalk(e.requestedWindow);
            e.requestedWindow = null;
          }
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
          controls.enabled = !drag && !planeControls.dragging;
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
      renderer.domElement.removeEventListener('contextmenu', contextMenu, true);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      renderer.domElement.removeEventListener('lostpointercapture', e.cancelObjectDrag);
      renderer.domElement.removeEventListener('pointerleave', leave);
      controls.removeEventListener('change', cameraChange);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      controls.dispose();
      scene.remove(planeHandles);
      planeControls.dispose();
      e.lightingRig.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            if (mat.userData.ownedMap) mat.map?.dispose();
            mat.dispose();
          }
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
            for (const mat of Array.isArray(n.material) ? n.material : [n.material]) {
              if (mat.userData.ownedMap) mat.map?.dispose();
              mat.dispose();
            }
        });
        g.remove(o);
      }
    };
    const buildingKey = JSON.stringify([project.building, project.rails]);
    if (buildingKey !== e.lightBuildingKey) {
      e.lightingRig.dispose();
      e.lightingRig = new LightingRig(e.scene, e.renderer, project.building, project.rails);
      e.lightBuildingKey = buildingKey;
    }
    e.renderer.shadowMap.needsUpdate = true;
    clear(e.world);
    clear(e.floorLines);
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
    ceiling.castShadow = true;
    ceiling.receiveShadow = true;
    ceiling.material.shadowSide = THREE.DoubleSide;
    e.ceiling.add(ceiling);
    // Door glazing is unconfirmed. Conservative shadow-only closures prevent sunlight
    // entering the model through schematic door gaps. Only N/S glazing admits daylight.
    for (const opening of [
      { x: 0, z: b.sideDoorAt, width: b.sideDoorWidth },
      { x: b.mainWidth, z: b.eastDoorAt, width: b.eastDoorWidth },
      { x: b.mainWidth, z: b.length - 2500, width: 2057 },
    ]) {
      const mask = new THREE.Mesh(
        new THREE.PlaneGeometry(m(opening.width), m(b.height)),
        new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mask.rotation.y = Math.PI / 2;
      mask.position.set(m(opening.x), m(b.height / 2), m(opening.z + opening.width / 2));
      mask.castShadow = true;
      mask.material.shadowSide = THREE.DoubleSide;
      mask.userData.editorOnly = true;
      e.world.add(mask);
    }
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
      mesh.castShadow = w.hangable;
      mesh.material.shadowSide = THREE.DoubleSide;
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
    }
    for (const f of glazingFrames(b))
      box(e.world, f.width, f.height, f.depth, f.x, f.y, f.z, '#65716d');
    {
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
        line.castShadow = false;
        line.receiveShadow = false;
        e.floorLines.add(line);
      }
    }
    for (const p of layout.partitions) {
      const g = partitionGeometry(p, project.rails);
      const mesh = box(e.world, p.width, p.height, p.thickness, g.x, p.height / 2, g.z, '#eeeede');
      mesh.rotation.y = g.rotation;
      mesh.userData.partitionId = p.id;
      mesh.material.shadowSide = THREE.DoubleSide;
      mesh.castShadow = true;
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
    for (const f of layout.steelFrames || []) {
      const group = makeSteelFrame(f, project);
      if (f.id === selectedSteelFrame)
        group.traverse((o) => {
          if (o.userData.steelMember) o.material.emissive.set('#594329');
        });
      e.world.add(group);
    }
    for (const f of compare?.steelFrames || []) e.ghostGroup.add(makeSteelFrame(f, project, true));
    const lineFaces = detectSteelLineFaces(layout.steelFrames);
    for (const face of lineFaces)
      e.world.add(
        makeSteelLineFace(
          face,
          layout.steelLineMembranes.find((m) => m.faceId === face.id),
          selectedSteelLineFace === face.id,
        ),
      );
    for (const face of detectSteelLineFaces(compare?.steelFrames || []))
      e.ghostGroup.add(makeSteelLineFace(face, null, false, true));
    host.current.dataset.steelLineFaceCount = String(lineFaces.length);
    host.current.dataset.steelLineMembraneCount = String(
      lineFaces.filter((f) => layout.steelLineMembranes.some((m) => m.faceId === f.id)).length,
    );
    host.current.dataset.steelFrameCount = String(layout.steelFrames?.length || 0);
    host.current.dataset.steelMembraneCount = String(
      (layout.steelFrames || []).reduce((n, f) => n + f.membrane.faces.length, 0),
    );
    // The structural details below are explicitly estimated, not surveyed dimensions.
    {
      const structure = new THREE.Group();
      e.world.add(structure);
      const structural = ceilingStructure(b, project.rails);
      e.structural = structural;
      if (host.current) {
        host.current.dataset.carrierCount = String(structural.carriers.length);
        host.current.dataset.concreteOnlyCount = String(
          structural.members.filter((m) => m.kind.startsWith('concrete-only')).length,
        );
      }
      const groups = new Map();
      for (const member of structural.members) {
        if (!groups.has(member.kind)) groups.set(member.kind, []);
        groups.get(member.kind).push(member);
      }
      for (const [kind, members] of groups) {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          material(members[0].color),
          members.length,
        );
        mesh.name = kind;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material.shadowSide = THREE.DoubleSide;
        const matrix = new THREE.Matrix4(),
          quaternion = new THREE.Quaternion();
        members.forEach((member, i) => {
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), member.rotation);
          matrix.compose(
            new THREE.Vector3(m(member.x), m(member.y), m(member.z)),
            quaternion,
            new THREE.Vector3(m(member.length), m(member.depth), m(member.width)),
          );
          mesh.setMatrixAt(i, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.userData.architectureMembers = members.map(
          ({ id, kind, railId, x, z, y, length, width, depth, rotation }) => ({
            id,
            kind,
            railId,
            x,
            z,
            y,
            length,
            width,
            depth,
            rotation,
          }),
        );
        structure.add(mesh);
      }
      const west = b.mainWidth - b.overallWidth,
        junction = b.length - b.wingDepth;
      box(
        structure,
        -west,
        280,
        b.wingDepth - 4970,
        west / 2,
        b.mezzanineHeight,
        junction + (b.wingDepth - 4970) / 2,
        '#b3b4a8',
      );
      box(
        structure,
        b.mainWidth,
        280,
        3650,
        b.mainWidth / 2,
        b.mezzanineHeight,
        b.length - 4970 - 3650 / 2,
        '#b3b4a8',
      );
      for (let x = west; x < b.mainWidth; x += 220)
        box(structure, 30, 950, 30, x, b.mezzanineHeight + 615, b.length - 4970 - 3650, '#9baba1');
      box(
        structure,
        b.overallWidth,
        55,
        55,
        (b.mainWidth + west) / 2,
        b.mezzanineHeight + 1100,
        b.length - 4970 - 3650,
        '#8d9b94',
      );
      for (let z = junction; z < b.length - 4970; z += 220)
        box(structure, 30, 950, 30, 0, b.mezzanineHeight + 615, z, '#9baba1');
      if (!details)
        structure.traverse((o) => {
          if (o.material) {
            o.material.colorWrite = false;
            o.material.depthWrite = false;
          }
        });
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
      g.visible = ghost || !movingPlacementIds.includes(p.id);
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
      if (a.image && !tex) {
        tex = e.loader.load(a.image);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, e.renderer.capabilities.getMaxAnisotropy());
        e.textures.set(a.image, tex);
      }
      const image = new THREE.Mesh(
        new THREE.PlaneGeometry(m(a.width - 8), m(a.height - 8)),
        new THREE.MeshStandardMaterial({
          map: tex || null,
          color: a.image ? '#ffffff' : '#eee9de',
          roughness: 0.95,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -2,
        }),
      );
      image.position.z = m(a.depth / 2) + 0.001;
      image.userData.placementId = p.id;
      image.receiveShadow = true;
      g.add(image);
      if (labelSettings?.enabled) {
        const label = makeArtworkLabel(a, p, w, layout, project.artworks, labelSettings);
        if (label) g.add(label);
      }
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
    if (host.current)
      host.current.dataset.artworkLabelCount = String(
        e.artGroup.children.filter((g) => g.children.some((o) => o.userData.artworkLabel)).length,
      );
  }, [
    geometryKey,
    selected,
    details,
    selectedPartition,
    selectedSteelFrame,
    selectedSteelLineFace,
    movingPlacementIds,
  ]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.refreshSteelPreview?.();
    const placingPlane = steelLineTool?.phase === 'plane';
    e.renderer.domElement.style.cursor = placingPartition
      ? 'crosshair'
      : steelLineTool
        ? placingPlane
          ? 'move'
          : 'crosshair'
        : '';
    e.controls.mouseButtons.RIGHT = steelLineTool ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    if (steelLineTool?.phase !== 'draw') e.lastSteelPointer = null;
    if (!placingPartition) e.lastPartitionPointer = null;
    e.workPlaneGroup.visible = !!steelLineTool;
    if (steelLineTool) {
      if (!e.planeControls.dragging && host.current.dataset.steelWorkplaneDragging !== 'true')
        e.workPlaneGroup.position.set(...steelPlaneCenter(steelLineTool).map(m));
      const rotation =
        steelLineTool.plane === 'xz'
          ? [-Math.PI / 2, 0, 0]
          : steelLineTool.plane === 'yz'
            ? [0, Math.PI / 2, 0]
            : [0, 0, 0];
      e.workPlaneSurface.rotation.set(...rotation);
      e.workPlaneOutline.rotation.set(...rotation);
      e.workPlaneGrid.rotation.set(
        steelLineTool.plane === 'xy' ? Math.PI / 2 : 0,
        0,
        steelLineTool.plane === 'yz' ? Math.PI / 2 : 0,
      );
      e.workPlaneSurface.visible = placingPlane;
      e.workPlaneOutline.material.opacity = placingPlane ? 0.9 : 0.35;
      e.workPlaneGroup.updateMatrixWorld(true);
    }
    e.planeControls.enabled = placingPlane;
    if (placingPlane) {
      if (e.planeControls.object !== e.workPlaneGroup) e.planeControls.attach(e.workPlaneGroup);
    } else {
      e.planeControls.detach();
      e.planeControls.dragging = false;
    }
    host.current.dataset.steelWorkplanePhase = steelLineTool?.phase || 'idle';
    host.current.dataset.steelWorkplaneCenter = steelLineTool
      ? steelPlaneCenter(steelLineTool).join(',')
      : '';
  }, [steelLineTool, placingPartition, geometryKey]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const group = e.partitionDraftGroup;
    for (const child of [...group.children]) {
      child.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      group.remove(child);
    }
    const p = placingPartition && partitionPreview?.partition;
    host.current.dataset.placingPartition = String(!!placingPartition);
    host.current.dataset.partitionPreviewRail = p?.railId || '';
    host.current.dataset.partitionPreviewS = String(p?.s ?? '');
    host.current.dataset.partitionPreviewValid = String(!!p && partitionPreview.valid);
    if (!p) return;
    const g = partitionGeometry(p, project.rails);
    const color = partitionPreview.valid ? '#468950' : '#d14935';
    const geometry = new THREE.BoxGeometry(m(p.width), m(p.height), m(p.thickness));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color,
        toneMapped: false,
      }),
    );
    mesh.add(edge);
    mesh.position.set(m(g.x), m(p.height / 2), m(g.z));
    mesh.rotation.y = g.rotation;
    group.add(mesh);
  }, [placingPartition, partitionPreview, project.rails]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const group = e.steelDraftGroup;
    for (const child of [...group.children]) {
      child.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      group.remove(child);
    }
    const preview = steelLinePreview;
    host.current.dataset.steelLineDrawing = String(steelLineTool?.phase === 'draw');
    host.current.dataset.steelLineValid = String(preview?.valid === true);
    host.current.dataset.steelLinePoint = preview?.point?.join(',') || '';
    host.current.dataset.steelLineStart = steelLineTool?.start?.join(',') || '';
    host.current.dataset.steelLineSnapped = String(preview?.snapped === true);
    host.current.dataset.steelLineSnapLabel = preview?.snapLabel || '';
    host.current.dataset.steelLineOrthogonalAxis =
      preview?.orthogonalAxis === undefined ? '' : ['X', 'Y', 'Z'][preview.orthogonalAxis];
    host.current.dataset.steelWorkplaneSnapped = String(
      steelLineTool?.phase === 'plane' && !!preview?.snapped,
    );
    if (!steelLineTool) return;
    const color = preview?.valid === false ? '#ce513b' : '#4d9c68';
    const marker = (point, c) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 8),
        new THREE.MeshBasicMaterial({ color: c, depthTest: false }),
      );
      mesh.position.set(...point.map(m));
      mesh.renderOrder = 10;
      group.add(mesh);
    };
    if (steelLineTool.phase === 'plane') {
      if (preview?.snapped) marker(preview.point, '#168b9a');
      return;
    }
    if (steelLineTool.start) marker(steelLineTool.start, '#b68b53');
    if (preview?.point) marker(preview.point, color);
    if (preview?.frame && preview.length > 0) {
      const beam = makeSteelFrame(preview.frame, project);
      beam.traverse((o) => {
        if (o.userData.steelMember) {
          o.material.color.set(color);
          o.material.transparent = true;
          o.material.opacity = 0.55;
          o.castShadow = false;
        }
      });
      group.add(beam);
    }
  }, [steelLineTool, steelLinePreview, project]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const g = e.previewGroup;
    for (const child of [...g.children]) {
      child.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      g.remove(child);
    }
    g.visible = false;
    const layout = project.layouts.find((l) => l.id === project.activeLayoutId);
    const items = placingArtworkId
      ? Array.from({ length: placingArtworkBatch?.count || 1 }, (_, i) => ({
          id: placingArtworkBatch ? `preview-${i}` : 'preview',
          artworkId: placingArtworkId,
        }))
      : layout.placements.filter((p) => movingPlacementIds.includes(p.id));
    host.current.dataset.placing = String(!!placingArtworkId);
    host.current.dataset.movingPlacement = movingPlacementId || '';
    host.current.dataset.movingCount = String(movingPlacementIds.length);
    if (!items.length) {
      e.lastPointer = null;
      e.cancelArtworkDrag?.();
      return;
    }
    for (const p of items) {
      const art = project.artworks.find((a) => a.id === p.artworkId);
      if (!art) continue;
      const group = new THREE.Group();
      group.userData.placementId = p.id;
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(m(art.width), m(art.height), m(art.depth)),
        new THREE.MeshBasicMaterial({
          color: '#72a777',
          toneMapped: false,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
      );
      let texture = e.textures.get(art.image);
      if (art.image && !texture) {
        texture = e.loader.load(art.image);
        texture.colorSpace = THREE.SRGBColorSpace;
        e.textures.set(art.image, texture);
      }
      const image = new THREE.Mesh(
        new THREE.PlaneGeometry(m(art.width), m(art.height)),
        new THREE.MeshBasicMaterial({
          map: texture || null,
          toneMapped: false,
          color: '#ffffff',
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
        }),
      );
      image.position.z = m(art.depth / 2) + 0.002;
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(frame.geometry),
        new THREE.LineBasicMaterial({ color: '#468950', linewidth: 2, toneMapped: false }),
      );
      group.add(frame, image, edge);
      g.add(group);
    }
  }, [
    placingArtworkId,
    placingArtworkBatch,
    movingPlacementId,
    movingPlacementIds,
    project.artworks,
  ]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const p = placementPreview?.placement;
    const previews = placementPreview?.placements || (p ? [p] : []);
    e.previewGroup.visible = previews.length > 0;
    host.current.dataset.previewValid = String(placementPreview?.valid === true);
    host.current.dataset.previewWall = p?.wallId || '';
    host.current.dataset.previewS = String(p?.s ?? '');
    host.current.dataset.previewBottom = String(p?.bottom ?? '');
    const l = project.layouts.find((l) => l.id === project.activeLayoutId),
      ws = walls(project.building, l.partitions, project.rails);
    for (const group of e.previewGroup.children) {
      const q = previews.find((p) => p.id === group.userData.placementId);
      const art = project.artworks.find((a) => a.id === q?.artworkId);
      const wall = ws.find((w) => w.id === q?.wallId);
      group.visible = !!(q && art && wall);
      if (!group.visible) continue;
      const pos = positionOnWall(wall, q.s, q.bottom, art);
      group.position.set(m(pos.x), m(pos.y), m(pos.z));
      group.rotation.y = pos.rotation;
      group.children.forEach((child, i) =>
        child.material.color.set(
          placementPreview.valid ? (i === 1 ? '#ffffff' : '#468950') : '#d14935',
        ),
      );
    }
    host.current.dataset.previewCount = String(
      e.previewGroup.children.filter((g) => g.visible).length,
    );
  }, [placementPreview, placingArtworkId, movingPlacementId, movingPlacementIds, project]);
  return <div className="scene-host" ref={host} />;
});
