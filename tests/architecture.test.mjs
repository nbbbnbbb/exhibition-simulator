import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/domain.js';
import { ceilingStructure, structuralBounds } from '../src/architecture.js';
import { fixtureLayout, occluderBoxes } from '../src/lighting.js';
const p = createProject(),
  b = p.building;
const close = (a, z) => assert.ok(Math.abs(a - z) < 1e-7, `${a} vs ${z}`);
test('全ての可動壁ラインと天井の可動壁レール中心線が一致する', () => {
  const s = ceilingStructure(b, p.rails);
  assert.deepEqual(s.carriers, ceilingStructure({ ...b, beamPitch: 5000 }, p.rails).carriers);
  assert.equal(s.carriers.length, p.rails.length);
  for (const r of p.rails) {
    const c = s.carriers.find((c) => c.railId === r.id),
      guide = s.members.find((m) => m.kind === 'partition-track' && m.railId === r.id);
    assert.deepEqual([c.x1, c.z1, c.x2, c.z2], [r.x1, r.z1, r.x2, r.z2]);
    close(guide.x - (guide.tangent.x * guide.length) / 2, r.x1);
    close(guide.z - (guide.tangent.z * guide.length) / 2, r.z1);
    close(guide.x + (guide.tangent.x * guide.length) / 2, r.x2);
    close(guide.z + (guide.tangent.z * guide.length) / 2, r.z2);
  }
});
test('可動壁ラインの変更・反転にレール付き梁と遮光形状が追従する', () => {
  const rails = structuredClone(p.rails);
  rails.find((r) => r.id === 'rail-cross-3').z1 = 14500;
  rails.find((r) => r.id === 'rail-cross-3').z2 = 14500;
  const c = rails.find((r) => r.id === 'rail-centre');
  c.x1 += 321;
  c.x2 += 321;
  [c.z1, c.z2] = [c.z2, c.z1];
  const s = ceilingStructure(b, rails);
  const line = s.members.find((m) => m.railId === c.id && m.kind === 'partition-track');
  assert.equal(line.x, c.x1);
  close(line.z - (line.tangent.z * line.length) / 2, c.z1);
  const beam = s.members.find((m) => m.railId === 'rail-cross-3' && m.kind === 'carrier-concrete');
  assert.equal(beam.z, 14500);
  const bounds = structuralBounds(beam);
  assert.ok(
    occluderBoxes(b, [], rails).some(
      ({ min, max }) => JSON.stringify({ min, max }) === JSON.stringify(bounds),
    ),
  );
});
test('可動壁レールを持たないコンクリート梁が残る', () => {
  const s = ceilingStructure(b, p.rails),
    plain = s.members.filter((m) => m.kind.startsWith('concrete-only'));
  assert.ok(plain.length >= 10);
  assert.ok(plain.every((m) => m.railId === null));
  assert.equal(plain.filter((m) => m.kind === 'concrete-only-spine').length, 3);
  for (const m of plain.filter((m) => m.kind === 'concrete-only-cross'))
    assert.ok(!s.carriers.some((c) => c.z1 === c.z2 && Math.abs(c.z1 - m.z) < 1));
});
test('スポットレールはコンクリート梁の下を通り、灯具がレールに接続する', () => {
  const s = ceilingStructure(b, p.rails),
    f = fixtureLayout(b, p.rails);
  for (const track of s.spotTracks) {
    const spine = s.members.find((m) => m.id.startsWith(`concrete-spine-${track.spineId}:`));
    assert.ok(spine);
    close(track.x, spine.x);
    if (track.supportId !== 'mezzanine-underside')
      assert.ok(track.y + track.depth / 2 < spine.y - spine.depth / 2);
  }
  for (const spot of f.spots) {
    const t = f.tracks.find((t) => t.id === spot.trackId);
    assert.ok(t);
    close(spot.position.x, t.x / 1000);
    close(spot.position.y, spot.mountPoint.y - 0.13);
    assert.ok(spot.position.z * 1000 >= t.z1 && spot.position.z * 1000 <= t.z2);
  }
});
