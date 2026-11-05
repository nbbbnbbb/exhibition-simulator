import * as THREE from 'three';
import { artworkLabelRows, normalizeLabels } from './artworkLabels.js';
// Editor labels stay centred above the artwork or overlay its front face.
export function makeArtworkLabel(art, placement, wall, settings) {
  settings = normalizeLabels(settings);
  const rows = artworkLabelRows(art, settings);
  if (!rows.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  const ctx = canvas.getContext('2d');
  const width = Math.min(settings.width, wall.length);
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
  canvas.height = Math.min(8192, textureHeight);
  ctx.scale(1, canvas.height / textureHeight);
  ctx.fillStyle = '#fcfcf6';
  ctx.fillRect(0, 0, canvas.width, textureHeight);
  ctx.strokeStyle = '#d0d5c9';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, textureHeight - 4);
  let y = 48;
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = font(line.title);
    ctx.fillStyle = line.title ? '#26382d' : '#4b594e';
    ctx.fillText(line.text, 55, y);
    y += lineHeight(line.title);
  }
  const height = (width * textureHeight) / canvas.width;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const overlay = settings.position === 'overlay';
  const material = new THREE.MeshBasicMaterial({
    map,
    toneMapped: false,
    transparent: overlay,
    opacity: overlay ? 0.9 : 1,
    depthWrite: !overlay,
  });
  material.userData.ownedMap = true;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width / 1000, height / 1000), material);
  card.name = `作品情報：${art.title}`;
  card.userData.editorOnly = true;
  card.userData.artworkLabel = {
    artworkId: art.id,
    placementId: placement.id,
    fields: rows.map((r) => r.key),
    fontSize: settings.fontSize,
    width,
    gap: settings.gap,
    position: settings.position,
  };
  card.position.set(
    0,
    overlay ? 0 : (art.height / 2 + settings.gap + height / 2) / 1000,
    art.depth / 2000 + 0.003,
  );
  return card;
}
