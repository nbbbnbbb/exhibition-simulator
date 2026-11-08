import * as THREE from 'three';
import { artworkLabelRows } from './artworkLabels.js';

const canvasWidth = 1024;

function makeLabelTexture(rows, width, settings) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const overlay = settings.position === 'overlay';
  const scale = (settings.fontSize / 16) * (650 / width);
  const font = (title) =>
    `${title ? '600 ' : ''}${(title ? 43 : 35) * scale}px "Yu Gothic", sans-serif`;
  const lineHeight = (title) => ((title ? 43 : 35) * scale * settings.lineHeight) / 100;
  const lines = [];
  for (const row of rows) {
    const title = row.key === 'title',
      text = (title ? '' : `${row.label}：`) + row.value;
    ctx.font = font(title);
    let line = '',
      count = 0;
    for (const char of text) {
      if (ctx.measureText(line + char).width > 900 || char === '\n') {
        lines.push({ text: line, title });
        line = '';
        count++;
        if (count >= 4) {
          line = '…';
          break;
        }
      }
      if (char !== '\n') line += char;
    }
    if (line) lines.push({ text: line, title });
  }
  const textureHeight = Math.ceil(100 + lines.reduce((sum, l) => sum + lineHeight(l.title), 0));
  const resolution = Math.min(0.5, 1024 / textureHeight);
  canvas.width = Math.ceil(canvasWidth * resolution);
  canvas.height = Math.ceil(textureHeight * resolution);
  ctx.scale(canvas.width / canvasWidth, canvas.height / textureHeight);
  if (!overlay) {
    ctx.fillStyle = '#fcfcf6';
    ctx.fillRect(0, 0, canvasWidth, textureHeight);
    ctx.strokeStyle = '#d0d5c9';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvasWidth - 4, textureHeight - 4);
  }
  let y = 48;
  ctx.textBaseline = 'top';
  ctx.textAlign = overlay ? 'center' : 'left';
  for (const line of lines) {
    ctx.font = font(line.title);
    if (overlay) {
      ctx.strokeStyle = '#1c211d';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, 5 * scale);
      ctx.strokeText(line.text, canvasWidth / 2, y);
      ctx.fillStyle = '#fffdf6';
    } else {
      ctx.fillStyle = line.title ? '#26382d' : '#4b594e';
    }
    ctx.fillText(line.text, overlay ? canvasWidth / 2 : 55, y);
    y += lineHeight(line.title);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return {
    map,
    width: width / 1000,
    height: (width * textureHeight) / canvasWidth / 1000,
    overlay,
  };
}

export function makeArtworkLabelCard(label) {
  const material = new THREE.MeshBasicMaterial({
    map: label.map,
    toneMapped: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(label.width, label.height), material);
  // Test against the room and works, then draw cards in a stable order without competing for depth.
  card.renderOrder = 2;
  card.name = '作品情報';
  card.userData.editorOnly = true;
  return card;
}

export function makeArtworkOverlay(baseMaterial, label, faceWidth, faceHeight) {
  const fit = Math.min(1, faceWidth / label.width, faceHeight / label.height);
  const uvScale = new THREE.Vector2(
    faceWidth / (label.width * fit),
    faceHeight / (label.height * fit),
  );
  const material = baseMaterial.clone();
  material.customProgramCacheKey = () => 'ma-artwork-overlay';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.maArtworkText = { value: label.map };
    shader.uniforms.maArtworkTextScale = { value: uvScale };
    shader.vertexShader = `varying vec2 vMaArtworkUv;\n${shader.vertexShader}`.replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\nvMaArtworkUv = uv;',
    );
    shader.fragmentShader = `
      varying vec2 vMaArtworkUv;
      uniform sampler2D maArtworkText;
      uniform vec2 maArtworkTextScale;
      ${shader.fragmentShader}
    `.replace(
      '#include <tonemapping_fragment>',
      `#include <tonemapping_fragment>
      vec2 labelUv = (vMaArtworkUv - 0.5) * maArtworkTextScale + 0.5;
      if (all(greaterThanEqual(labelUv, vec2(0.0))) && all(lessThanEqual(labelUv, vec2(1.0)))) {
        vec4 textColor = texture2D(maArtworkText, labelUv);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, textColor.rgb, textColor.a);
      }`,
    );
  };
  return material;
}

export function clearArtworkLabel(surface) {
  const { card, image, material } = surface;
  if (card) {
    card.removeFromParent();
    card.geometry.dispose();
    card.material.dispose();
    surface.card = null;
  }
  if (image.material !== material) {
    image.material.dispose();
    image.material = material;
  }
  surface.label = null;
}

export function updateArtworkLabels(surfaces, textures, settings) {
  if (!settings?.enabled) {
    surfaces.forEach(clearArtworkLabel);
    return 0;
  }
  const used = new Set();
  const rowsByArtwork = new Map();
  let count = 0;
  for (const surface of surfaces.values()) {
    const { art, group, image, material, wallLength } = surface;
    if (!rowsByArtwork.has(art.id)) rowsByArtwork.set(art.id, artworkLabelRows(art, settings));
    const rows = rowsByArtwork.get(art.id);
    if (!rows.length) {
      clearArtworkLabel(surface);
      continue;
    }
    const { width: faceWidth, height: faceHeight } = image.geometry.parameters;
    const width = Math.min(
      settings.width,
      settings.position === 'overlay' ? faceWidth * 1000 : wallLength,
    );
    const key = JSON.stringify([
      rows,
      width,
      settings.fontSize,
      settings.lineHeight,
      settings.position,
    ]);
    used.add(key);
    let label = textures.get(key);
    if (!label) {
      label = makeLabelTexture(rows, width, settings);
      textures.set(key, label);
    }
    if (surface.label !== label) {
      clearArtworkLabel(surface);
      surface.label = label;
      if (label.overlay)
        image.material = makeArtworkOverlay(material, label, faceWidth, faceHeight);
      else {
        surface.card = makeArtworkLabelCard(label);
        group.add(surface.card);
      }
    }
    surface.card?.position.set(
      0,
      (art.height / 2 + settings.gap) / 1000 + label.height / 2,
      image.position.z + 0.003,
    );
    count++;
  }
  for (const [key, label] of textures) {
    if (used.has(key)) continue;
    label.map.dispose();
    textures.delete(key);
  }
  return count;
}
