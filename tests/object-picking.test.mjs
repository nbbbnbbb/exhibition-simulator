import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject } from '../src/domain.js';
import { newSteelFrame } from '../src/steelFrames.js';
import { makeSteelFrame } from '../src/SteelFrames3D.js';
import { pickContextObject } from '../src/objectPicking.js';

const hit = (distance, userData = {}, material = { colorWrite: true }) => ({
  distance,
  object: { userData, material },
});

test('見えている鉄骨・ライン膜・作品・可動壁を選び、遮蔽物の奥や膜のない自動面を選ばない', () => {
  const steel = hit(5, { steelFrameId: 'line', uiOnly: true }, { colorWrite: false });
  assert.equal(pickContextObject([steel], []).id, 'line');
  assert.equal(pickContextObject([hit(3), steel], []), null);
  assert.equal(pickContextObject([hit(3)], [hit(4, { placementId: 'art' })]), null);
  assert.equal(pickContextObject([steel], [hit(2, { placementId: 'art' })]).type, 'artwork');
  assert.equal(pickContextObject([hit(2, { partitionId: 'part' }), steel], []).type, 'partition');
  const emptyFace = hit(
    1,
    { steelLineFaceId: 'empty', steelLineMembrane: false },
    { transparent: true, opacity: 0.045 },
  );
  assert.equal(pickContextObject([emptyFace], []), null);
  const membrane = hit(
    1,
    { steelLineFaceId: 'face', steelLineMembrane: true },
    { transparent: true, opacity: 0.35 },
  );
  assert.deepEqual(pickContextObject([membrane, steel], []), {
    type: 'steel-line-face',
    id: 'face',
  });
});

test('膜の内部は膜だけを、境界に近い拡大ヒット領域は鉄骨部材を選ぶ', () => {
  const membrane = hit(
    5,
    { steelLineFaceId: 'face', steelLineMembrane: true },
    { transparent: true, opacity: 0.35 },
  );
  const border = hit(5.05, { steelFrameId: 'border', uiOnly: true }, { colorWrite: false });
  assert.equal(pickContextObject([membrane, border], []).type, 'steel-frame');
  border.distance = 7;
  assert.equal(pickContextObject([membrane, border], []).type, 'steel-line-face');
});

test('実際の3Dフレームの膜に当たった光線は、面番号0を保持して膜を対象にする', () => {
  const project = createProject(),
    frame = newSteelFrame(project, 'rectangle', 'frame');
  frame.membrane.faces = [0];
  const group = makeSteelFrame(frame, project);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(frame.x / 1000, frame.height / 2000, frame.z / 1000 + 3),
    new THREE.Vector3(0, 0, -1),
  );
  assert.deepEqual(pickContextObject(ray.intersectObject(group, true), []), {
    type: 'steel-membrane',
    id: frame.id,
    faceIndex: 0,
  });
  frame.membrane.faces = [];
  const bare = makeSteelFrame(frame, project);
  bare.updateMatrixWorld(true);
  assert.equal(pickContextObject(ray.intersectObject(bare, true), []), null);
});
