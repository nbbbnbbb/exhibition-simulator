// Convert the supplied CAD-export SVG into independent, tightly cropped silhouettes.
// Usage: node scripts/split-silhouettes.mjs path/to/source.svg
import fs from 'node:fs/promises';
import path from 'node:path';
const source = await fs.readFile(process.argv[2], 'utf8');
const polygons = [...source.matchAll(/<g id="([^"]+)"[^>]*>\s*<polygon[^>]*points="([^"]+)"/g)]
  .map(([, sourceId, raw]) => {
    const values = raw.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const points = Array.from({ length: values.length / 2 }, (_, i) =>
      values.slice(i * 2, i * 2 + 2),
    );
    const minX = Math.min(...points.map((p) => p[0])),
      minY = Math.min(...points.map((p) => p[1]));
    const width = Math.max(...points.map((p) => p[0])) - minX;
    const height = Math.max(...points.map((p) => p[1])) - minY;
    return {
      sourceId,
      minX,
      minY,
      aspect: width / height,
      points: points.map(([x, y]) => [(x - minX) / height, (y - minY) / height]),
    };
  })
  .sort((a, b) => Math.round(a.minY / 3000) - Math.round(b.minY / 3000) || a.minX - b.minX);
if (polygons.length !== 11)
  throw new Error('Expected 11 individual outlines from the supplied SVG');
const out = path.resolve('public/silhouettes');
await fs.mkdir(out, { recursive: true });
const silhouettes = [];
for (const [i, p] of polygons.entries()) {
  const id = `person-${String(i + 1).padStart(2, '0')}`,
    name = `人物 ${String(i + 1).padStart(2, '0')}`;
  const points = p.points.map((point) => point.map((v) => Number(v.toFixed(8))));
  const aspect = Number(p.aspect.toFixed(8));
  silhouettes.push({ id, name, sourceId: p.sourceId, aspect, points });
  await fs.writeFile(
    path.join(out, `${id}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${aspect} 1"><title>${name}</title><polygon fill="#808080" points="${points.map((p) => p.join(',')).join(' ')}"/></svg>\n`,
  );
}
await fs.writeFile('src/silhouettes.json', JSON.stringify(silhouettes) + '\n');
console.log(`Split ${silhouettes.length} silhouettes`);
