import * as THREE from 'three';
import { artworkLabelRows } from './artworkLabels.js';
// A world-space card stays next to its artwork in desktop and immersive views.
export function makeArtworkLabel(art, placement, wall, layout, artworks, settings) {
  const rows = artworkLabelRows(art, settings);
  if (!rows.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  const ctx = canvas.getContext('2d');
  const lines = [];
  for (const row of rows) {
    const title = row.key === 'title',
      text = (title ? '' : `${row.label}：`) + row.value;
    ctx.font = `${title ? '600 43' : '35'}px "Yu Gothic", sans-serif`;
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
  canvas.height = 100 + lines.reduce((sum, l) => sum + (l.title ? 66 : 53), 0);
  ctx.fillStyle = '#fcfcf6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d0d5c9';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  let y = 48;
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = `${line.title ? '600 43' : '35'}px "Yu Gothic", sans-serif`;
    ctx.fillStyle = line.title ? '#26382d' : '#4b594e';
    ctx.fillText(line.text, 55, y);
    y += line.title ? 66 : 53;
  }
  const width = Math.min(650, wall.length),
    height = (width * canvas.height) / canvas.width;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map, toneMapped: false });
  material.userData.ownedMap = true;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width / 1000, height / 1000), material);
  card.name = `作品情報：${art.title}`;
  card.userData.editorOnly = true;
  card.userData.artworkLabel = {
    artworkId: art.id,
    placementId: placement.id,
    fields: rows.map((r) => r.key),
  };
  const sign = wall.normal.z * wall.tangent.x - wall.normal.x * wall.tangent.z;
  const maxBottom = Math.max(0, wall.height - height);
  const bottom = Math.min(placement.bottom, maxBottom);
  const right = placement.s + sign * (art.width / 2 + 90 + width / 2),
    left = placement.s - sign * (art.width / 2 + 90 + width / 2);
  const free = (s, b) =>
    s >= width / 2 &&
    s + width / 2 <= wall.length &&
    b >= 0 &&
    b + height <= wall.height &&
    !layout.placements.some((p) => {
      const other = artworks.find((a) => a.id === p.artworkId);
      return (
        p.wallId === placement.wallId &&
        other &&
        Math.abs(p.s - s) < (other.width + width) / 2 &&
        b < p.bottom + other.height &&
        p.bottom < b + height
      );
    });
  const candidates = [
    [right, bottom],
    [left, bottom],
    [placement.s, placement.bottom - height - 90],
    [placement.s, placement.bottom + art.height + 90],
  ];
  const [s, b] = candidates.find(([s, b]) => free(s, b)) || [
    Math.max(width / 2, Math.min(wall.length - width / 2, right)),
    bottom,
  ];
  card.position.set(
    (sign * (s - placement.s)) / 1000,
    (b + height / 2 - placement.bottom - art.height / 2) / 1000,
    art.depth / 2000 + 0.003,
  );
  return card;
}
