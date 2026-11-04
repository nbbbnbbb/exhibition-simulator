import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  fixtureLayout,
  solarState,
  kelvinRGB,
  spotCandela,
  railLuminance,
  windowAreas,
  indirectLux,
  reflectedLight,
  skyBackgroundBlend,
  SKY_SCATTER_LIGHT,
  windowScatterCandela,
} from './lighting.js';

const vector = (p) => new THREE.Vector3(p.x, p.y, p.z);
const color = (k) => new THREE.Color().setRGB(...kelvinRGB(k), THREE.SRGBColorSpace);
function rect(area) {
  const light = new THREE.RectAreaLight('#ffffff', 0, area.width, area.height);
  light.position.copy(vector(area.position));
  const u = vector(area.u),
    v = vector(area.v),
    normal = vector(area.normal);
  if (new THREE.Vector3().crossVectors(u, v).dot(normal) > 0) v.negate();
  light.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(u, v, new THREE.Vector3().crossVectors(u, v)),
  );
  return light;
}
export class LightingRig {
  constructor(scene, renderer, b, partitionRails) {
    RectAreaLightUniformsLib.init();
    this.scene = scene;
    this.renderer = renderer;
    this.building = b;
    this.fixtures = fixtureLayout(b, partitionRails);
    this.group = new THREE.Group();
    this.group.name = 'Ceiling fixtures (estimated)';
    this.group.userData.editorOnly = true;
    scene.add(this.group);
    this.sun = new THREE.DirectionalLight('#fff3dd', 0);
    this.sun.name = 'Sun through glazing';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const span = (Math.max(b.length, b.overallWidth) / 1000) * 0.68;
    Object.assign(this.sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 0.1,
      far: 180,
    });
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.012;
    this.group.add(this.sun, this.sun.target);
    // Interior reflection approximation, driven only by enabled light sources.
    // The ground hemisphere lights downward-facing ceilings and beam soffits most strongly.
    this.indirect = new THREE.HemisphereLight('#ffffff', '#ffffff', 0);
    this.indirect.name = 'Approximate floor and wall reflection';
    this.group.add(this.indirect);
    this.spots = this.fixtures.spots.map((f) => {
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.13, 0.045),
        new THREE.MeshStandardMaterial({ color: '#d4d7cd', roughness: 0.7 }),
      );
      bracket.position.set(f.mountPoint.x, f.mountPoint.y - 0.065, f.mountPoint.z);
      this.group.add(bracket);
      const light = new THREE.SpotLight('#ffffff', 0, 0, Math.PI / 6, 0.4, 2);
      light.name = 'Spot ' + f.id;
      light.position.copy(vector(f.position));
      light.target.position.copy(vector(f.target));
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.08;
      light.shadow.camera.far = 30;
      light.shadow.normalBias = 0.006;
      light.shadow.bias = -0.00005;
      this.group.add(light, light.target);
      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.19, 12),
        new THREE.MeshStandardMaterial({ color: '#a9ae9e', roughness: 0.7 }),
      );
      housing.position.copy(light.position);
      housing.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        vector(f.target).sub(light.position).normalize(),
      );
      this.group.add(housing);
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.057, 16),
        new THREE.MeshStandardMaterial({
          color: '#f0f0e8',
          emissive: '#ffffff',
          emissiveIntensity: 0,
        }),
      );
      lens.position
        .copy(light.position)
        .addScaledVector(vector(f.target).sub(light.position).normalize(), 0.099);
      lens.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        vector(f.target).sub(light.position).normalize(),
      );
      this.group.add(lens);
      return { light, lens };
    });
    for (const track of this.fixtures.tracks) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(track.width / 1000, track.depth / 1000, (track.z2 - track.z1) / 1000),
        new THREE.MeshStandardMaterial({ color: '#bcc1b6', roughness: 0.65 }),
      );
      body.name = track.id;
      body.position.set(track.x / 1000, track.y / 1000, (track.z1 + track.z2) / 2000);
      body.userData.spotTrack = { ...track };
      this.group.add(body);
      const gap = track.supportY - track.y - track.depth / 2,
        clipCount = Math.max(1, Math.ceil((track.z2 - track.z1) / b.beamPitch));
      const clips = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.025, gap / 1000, 0.04),
        new THREE.MeshStandardMaterial({ color: '#bec5b8', roughness: 0.7 }),
        clipCount,
      );
      clips.name = 'Spot track mounting clips';
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < clipCount; i++) {
        matrix.makeTranslation(
          track.x / 1000,
          (track.supportY + track.y + track.depth / 2) / 2000,
          (track.z1 + ((track.z2 - track.z1) * (i + 0.5)) / clipCount) / 1000,
        );
        clips.setMatrixAt(i, matrix);
      }
      clips.instanceMatrix.needsUpdate = true;
      this.group.add(clips);
    }
    this.rails = this.fixtures.rails.map((a) => {
      const light = rect(a);
      light.name = 'Continuous rail light';
      this.group.add(light);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(a.width, 0.01, a.height),
        new THREE.MeshStandardMaterial({
          color: '#e6e8dd',
          emissive: '#ffffff',
          emissiveIntensity: 0,
        }),
      );
      mesh.position.copy(vector(a.position));
      this.group.add(mesh);
      return { light, mesh };
    });
    this.windows = windowAreas(
      b,
      { ...{ northSky: 1, southSky: 1 }, skyLux: 0, glassTransmission: 0 },
      { skyFactor: 0 },
    ).map((a) => {
      const light = rect(a);
      light.name = 'Diffuse sky through ' + a.id;
      this.group.add(light);
      return light;
    });
    this.skyShadows = windowAreas(
      b,
      { northSky: 1, southSky: 1, skyLux: 0, glassTransmission: 0 },
      { skyFactor: 0 },
    ).map((a) => {
      const light = new THREE.SpotLight(
        '#ffffff',
        0,
        0,
        THREE.MathUtils.degToRad(SKY_SCATTER_LIGHT.angle),
        SKY_SCATTER_LIGHT.penumbra,
        2,
      );
      light.name = 'Diffuse window shadow ' + a.id;
      light.position.copy(vector(a.position));
      light.target.position.copy(light.position).add(vector(a.normal));
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 0.06;
      light.shadow.camera.far = 120;
      light.shadow.radius = 3.5;
      light.shadow.normalBias = 0.008;
      light.shadow.bias = -0.00005;
      this.group.add(light, light.target);
      return light;
    });
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
  }
  update(l) {
    if (this.last === l) return null;
    const previous = this.last;
    this.last = l;
    const sun = solarState(l),
      b = this.building;
    const becameLit =
      (this.sun.intensity === 0 && sun.normalLux > 0) ||
      (!previous?.spots && l.spots) ||
      (previous?.spotLux === 0 && l.spotLux > 0);
    this.scene.background
      .set('#131911')
      .lerp(new THREE.Color('#dedfda'), l.daylight ? skyBackgroundBlend(sun.altitude) : 0);
    this.scene.fog?.color.copy(this.scene.background);
    const target = new THREE.Vector3((b.mainWidth - b.overallWidth) / 4000, 1, b.length / 2000);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(vector(sun.direction), 70);
    this.sun.color.copy(color(sun.altitude < 15 ? 3600 : 5200));
    this.sun.intensity = sun.normalLux;
    this.sun.shadow.radius = 0.25 + l.sunSoftness * 8;
    this.spots.forEach(({ light, lens }, i) => {
      light.color.copy(color(l.spotKelvin));
      light.intensity = spotCandela(l, this.fixtures.spots[i]);
      light.angle = THREE.MathUtils.degToRad(l.spotAngle / 2);
      light.penumbra = l.spotSoftness;
      light.shadow.radius = 0.5 + l.spotSoftness * 3;
      lens.material.emissive.copy(light.color);
      lens.material.emissiveIntensity =
        l.spots && l.spotLux > 0 ? Math.min(200, l.spotLux * 0.5) : 0;
    });
    const luminance = railLuminance(l, b, this.fixtures);
    this.rails.forEach(({ light, mesh }) => {
      light.color.copy(color(l.railKelvin));
      light.intensity = luminance;
      mesh.material.emissive.copy(light.color);
      mesh.material.emissiveIntensity = luminance * 0.2;
    });
    const areas = windowAreas(b, l, sun);
    const skyBecameLit = this.skyShadows.some(
      (light, i) => light.intensity === 0 && areas[i].luminance > 0,
    );
    this.windows.forEach((light, i) => {
      light.color.copy(color(7500));
      light.intensity = areas[i].luminance * (1 - SKY_SCATTER_LIGHT.fraction);
    });
    this.skyShadows.forEach((light, i) => {
      light.color.copy(color(7500));
      light.intensity = windowScatterCandela(areas[i]);
    });
    const bounce = reflectedLight(l, sun);
    const warm = color(l.railKelvin)
      .multiplyScalar(bounce.rail)
      .add(color(l.spotKelvin).multiplyScalar(bounce.spot))
      .add(color(7500).multiplyScalar(bounce.sky))
      .add(color(sun.altitude < 15 ? 3600 : 5200).multiplyScalar(bounce.sun));

    const max = Math.max(warm.r, warm.g, warm.b, 0.001);
    warm.multiplyScalar(1 / max);
    this.indirect.groundColor.copy(warm);
    this.indirect.color.copy(warm).multiplyScalar(0.25);
    this.indirect.intensity = indirectLux(l, sun);
    this.renderer.toneMappingExposure = 0.015 * Math.pow(2, l.exposureEV);
    if (
      !previous ||
      becameLit ||
      skyBecameLit ||
      ['date', 'minutes', 'latitude', 'longitude', 'sunSoftness', 'spotSoftness', 'spotAngle'].some(
        (k) => previous[k] !== l[k],
      )
    )
      this.renderer.shadowMap.needsUpdate = true;
    return sun;
  }
  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
      o.shadow?.map?.dispose();
      o.shadow?.mapPass?.dispose();
    });
    this.group.removeFromParent();
  }
}
